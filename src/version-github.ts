import { BaseVersioner } from "./version-base";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { ReleaseBranch } from "./interfaces";
import semver from "semver";

dotenv.config();

interface GitHubVersionerOptions {
  owner: string;
  repo: string;
}

export default class GitHubVersioner extends BaseVersioner {
  private gitHub: Octokit;
  private owner: string;
  private repo: string;

  constructor(opts: GitHubVersionerOptions) {
    super();
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.gitHub = new Octokit({ auth: process.env.GITHUB_TOKEN ?? undefined });
  }

  async getVersionForCommit(sha: string) {
    const currentBranch = await this.getBranchForCommit(sha);
    console.error("Determined branch for commit:", currentBranch);

    const releaseBranches = await this.getReleaseBranches();

    if (
      currentBranch === this.DEFAULT_BRANCH ||
      currentBranch === `origin/${this.DEFAULT_BRANCH}`
    ) {
      let lastReleaseBranchWithAncestor = undefined;
      for (const releaseBranch of releaseBranches) {
        let isAncestor = false;
        const releaseBranchPoint = await this.getMergeBase(
          releaseBranch.branch,
          `${this.DEFAULT_BRANCH}`
        );
        if (releaseBranchPoint === sha) {
          isAncestor = false;
        } else {
          isAncestor = await this.isAncestor(releaseBranchPoint, sha);
        }
        if (!isAncestor) break;
        lastReleaseBranchWithAncestor = releaseBranch;
      }

      if (lastReleaseBranchWithAncestor) {
        const targetMajor = lastReleaseBranchWithAncestor.version.major;
        const targetMinor = lastReleaseBranchWithAncestor.version.minor + 1;

        console.error(
          `On ${this.DEFAULT_BRANCH} so the version is considered to be the next unreleased minor`,
          `${targetMajor}.${targetMinor}`
        );

        const firstCommitInLatestRelease = await this.getMergeBase(
          `${this.DEFAULT_BRANCH}`,
          lastReleaseBranchWithAncestor.branch
        );
        const commitsSinceLatestReleaseBranch = await this.getDistance(
          firstCommitInLatestRelease,
          sha
        );
        console.error(
          `${commitsSinceLatestReleaseBranch} commits on ${this.DEFAULT_BRANCH} since the last minor was branched`
        );

        return `${targetMajor}.${targetMinor}.${commitsSinceLatestReleaseBranch}`;
      } else {
        const firstCommit = await this.getFirstCommit();
        const commitsSinceInitialCommit = await this.getDistance(
          firstCommit,
          sha
        );
        return `0.0.${commitsSinceInitialCommit}`;
      }
    } else if (this.releaseBranchMatcher.test(currentBranch)) {
      // If we're on a release branch then the version === {current_major}.{current_minor}.{commits_since_branch_of_minor + commits_on_master_between_last_branch_and_this_branch}
      const releaseBranchIndex = releaseBranches.findIndex(
        (branch) => branch.branch === currentBranch.replace(/^origin\//, "")
      );
      const releaseBranch = releaseBranches[releaseBranchIndex];

      if (!releaseBranch) {
        throw new Error(
          "Failed to find remote branch for current release branch, ensure it is pushed to the remote"
        );
      }

      console.error(
        "On an active release branch so the version is considered to be the current minor",
        `${releaseBranch.version.major}.${releaseBranch.version.minor}`
      );

      // If we're on the first-ever release branch, we count versions from the dawn of time
      if (releaseBranchIndex === 0) {
        const firstCommit = await this.getFirstCommit();
        const commitsSinceInitialCommit = await this.getDistance(
          firstCommit,
          sha
        );

        return `${releaseBranch.version.major}.${releaseBranch.version.minor}.${commitsSinceInitialCommit}`;
      } else {
        const previousReleaseBranch = releaseBranches[releaseBranchIndex - 1];
        console.error(
          "Determined previous release branch to be:",
          previousReleaseBranch.branch
        );

        const firstCommitInPreviousRelease = await this.getMergeBase(
          this.DEFAULT_BRANCH,
          previousReleaseBranch.branch
        );
        const firstCommitInCurrentRelease = await this.getMergeBase(
          this.DEFAULT_BRANCH,
          releaseBranch.branch
        );
        const commitsOnDefaultBranchBetweenReleases = await this.getDistance(
          firstCommitInPreviousRelease,
          firstCommitInCurrentRelease
        );
        console.error(
          "Calculated that there were",
          commitsOnDefaultBranchBetweenReleases,
          "commits on the",
          this.DEFAULT_BRANCH,
          "branch between the previous release and this release"
        );

        const commitsInCurrentRelease = await this.getDistance(
          firstCommitInCurrentRelease,
          sha
        );
        console.error(
          "Calculated that there are",
          commitsInCurrentRelease,
          "commits on the",
          currentBranch,
          "branch since its inception till",
          sha
        );

        return `${releaseBranch.version.major}.${releaseBranch.version.minor}.${
          commitsInCurrentRelease + commitsOnDefaultBranchBetweenReleases
        }`;
      }
    } else {
      // If we're on a random branch the version number should obviously be garbage yet also be valid, a good middle ground is {nearest_major_branch}.{nearest_minor_branch}.65535
      const nearestReleaseBranch = await this.getNearestReleaseBranch(
        releaseBranches
      );

      console.error(
        "On a non-release branch, determined the nearest release branch is:",
        nearestReleaseBranch.branch
      );
      return `${nearestReleaseBranch.version.major}.${nearestReleaseBranch.version.minor}.${this.UNSAFE_BRANCH_PATCH}`;
    }
  }

  public async getMASBuildVersion(): Promise<string> {
    const zeroPad = (n: number, width: number) => {
      return `${n}`.padStart(width, "0");
    };
    const currentBranch = await this.getBranchForCommit(
      await this.getHeadSHA()
    );
    if (this.releaseBranchMatcher.test(currentBranch)) {
      const version = await this.getVersionForHeadCached();
      const parsedVersion = semver.parse(version)!;
      // 4.26.123
      // 426000123
      return `${parsedVersion.major}${zeroPad(parsedVersion.minor, 2)}${zeroPad(
        parsedVersion.patch,
        6
      )}`;
    }
    // If we aren't on a release branch we should return a buildVersion that can not be released
    return "0";
  }

  protected async getHeadSHA(): Promise<string> {
    const response = await this.gitHub.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref: this.DEFAULT_BRANCH,
    });

    return response.data.sha;
  }

  protected async getAllBranches() {
    const response = await this.gitHub.rest.repos.listBranches({
      owner: this.owner,
      repo: this.repo,
    });

    return response.data.map((branch) => branch.name);
  }

  protected async getBranchForCommit(SHA: string) {
    const branches = [
      ...(await this.getReleaseBranches()).map((b) => b.branch),
      this.DEFAULT_BRANCH,
    ];

    const possibleBranches: string[] = [];

    for (const branch of branches) {
      const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
        owner: this.owner,
        repo: this.repo,
        basehead: `${branch}...${SHA}`,
      });

      if (res.data.status === "behind" || res.data.status === "identical") {
        possibleBranches.push(branch);
      }
    }
    console.error(`Found release branch(es) [${possibleBranches.join(", ")}].`);

    possibleBranches.sort((a, b) => {
      if (a === this.DEFAULT_BRANCH) return -1;
      if (b === this.DEFAULT_BRANCH) return 1;
      const [, aMinor] = this.releaseBranchMatcher.exec(a)!;
      const [, bMinor] = this.releaseBranchMatcher.exec(b)!;
      return parseInt(aMinor, 10) - parseInt(bMinor, 10);
    });
    console.error(
      `Determined branch order [${possibleBranches.join(
        ", "
      )}]. Using first one.`
    );

    return possibleBranches[0];
  }

  private async getMergeBase(from: string, to: string) {
    const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${from}...${to}`,
    });

    return res.data.merge_base_commit.sha.slice(0, 7).trim();
  }

  private async isAncestor(from: string, to: string) {
    const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${from}...${to}`,
    });

    return res.data.status === "ahead";
  }

  private async getFirstCommit() {
    // No direct API for this. To do this in constant time, there's a workaround
    // involving some GraphQL-only APIs.
    // See https://stackoverflow.com/a/62336529/5602134 for information
    const lastCommit: any = await this.gitHub.graphql(
      `{
        repository(name: "${this.repo}", owner: "${this.owner}") {
          ref(qualifiedName: "${this.DEFAULT_BRANCH}") {
            target {
              ... on Commit {
                history(first: 1) {
                  totalCount
                  pageInfo {
                    endCursor
                  }
                }
              }
            }
          }
        }
      }
      `
    );

    const numCommits = lastCommit.repository.ref.target.history.totalCount;
    const lastCommitSHA =
      lastCommit.repository.ref.target.history.pageInfo.endCursor.split(" ")[0];
    const magicIncantation = `${lastCommitSHA} ${numCommits - 2}`;

    const firstCommit: any = await this.gitHub.graphql(
      `{
        repository(name: "${this.repo}", owner: "${this.owner}") {
          ref(qualifiedName: "${this.DEFAULT_BRANCH}") {
            target {
              ... on Commit {
                history(first: 1, after: "${magicIncantation}") {
                  nodes {
                    message
                    committedDate
                    authoredDate
                    oid
                    author {
                      email
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
      `
    );

    return firstCommit.repository.ref.target.history.nodes[0].oid;
  }

  private async getNearestReleaseBranch(releaseBranches: ReleaseBranch[]) {
    let nearestReleaseBranch = {
      branch: this.DEFAULT_BRANCH,
      version: semver
        .parse(releaseBranches[releaseBranches.length - 1].version.format())!
        .inc("minor"),
    };
    for (const releaseBranch of releaseBranches) {
      const branchPointOfReleaseBranch = await this.getMergeBase(
        `${this.DEFAULT_BRANCH}`,
        releaseBranch.branch
      );
      const branchPointOfHead = await this.getMergeBase(
        `${this.DEFAULT_BRANCH}`,
        "HEAD"
      );
      if (branchPointOfReleaseBranch === branchPointOfHead) {
        nearestReleaseBranch = releaseBranch;
        break;
      }
    }

    return nearestReleaseBranch;
  }

  private async getDistance(from: string, to: string) {
    const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${from}...${to}`,
    });

    return res.data.total_commits;
  }
}
