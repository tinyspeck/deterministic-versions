import * as semver from "semver";
import { spawn } from "@malept/cross-spawn-promise";
import path from "path";
import fs from "fs";
import { ReleaseBranch } from "./interfaces";
import { BaseVersioner } from "./version-base";

interface LocalVersionerOptions {
  pathToRepo?: string;
  defaultBranch?: string;
}

export default class LocalVersioner extends BaseVersioner {
  private pathToRepo: string;

  constructor(opts: LocalVersionerOptions) {
    super();
    this.pathToRepo = opts.pathToRepo
      ? path.resolve(opts.pathToRepo)
      : process.cwd();

    this.DEFAULT_BRANCH = opts.defaultBranch || "main";

    if (!fs.existsSync(this.pathToRepo)) {
      throw new Error(
        `Attempted to use path ${this.pathToRepo} but doesn't exist!`
      );
    }
  }

  /**
   * Spawns a git child process with the working directory
   * set to the path of the local repository
   * @param command
   * @returns Promise<string>
   */
  private async spawnGit(command: string[]) {
    return spawn("git", command, { cwd: this.pathToRepo });
  }

  async getVersionForHead() {
    const head = await this.getHeadSHA();
    console.error("Determined head commit:", head);
    return await this.getVersionForCommit(head);
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
          `origin/${this.DEFAULT_BRANCH}`
        );
        // If we are literally on the merge point consider it not an ancestor
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
          `origin/${this.DEFAULT_BRANCH}`,
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

  /**
   * The MAS Build Version simply has to be an ever-increasing number
   * We never release MAS from the "master" branch, only ever from release branches
   * We can use the number of commits on the current branch prefixed with the current
   * minor release number to ensure an increasing build number
   */
  async getMASBuildVersion() {
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

  private async getHeadSHA() {
    return (await this.spawnGit(["rev-parse", "HEAD"])).trim();
  }

  private async getBranchForCommit(SHA: string) {
    const possibleBranches = (
      await this.spawnGit(["branch", "--contains", SHA, "--remote"])
    )
      .trim()
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => !b.includes(" -> "))
      .map((b) => b.replace(/^origin\//, ""));
    const possibleReleaseBranches = possibleBranches.filter(
      (branch) =>
        this.releaseBranchMatcher.test(branch) || branch === this.DEFAULT_BRANCH
    );
    console.error(
      `Found release branch(es) [${possibleReleaseBranches.join(", ")}].`
    );
    possibleReleaseBranches.sort((a, b) => {
      if (a === this.DEFAULT_BRANCH) return -1;
      if (b === this.DEFAULT_BRANCH) return 1;
      const [, aMinor] = this.releaseBranchMatcher.exec(a)!;
      const [, bMinor] = this.releaseBranchMatcher.exec(b)!;
      return parseInt(aMinor, 10) - parseInt(bMinor, 10);
    });
    console.error(
      `Determined branch order [${possibleReleaseBranches.join(
        ", "
      )}]. Using first one.`
    );
    return `origin/${possibleReleaseBranches[0]}`;
  }

  private async getMergeBase(from: string, to: string) {
    return (await this.spawnGit(["merge-base", from, to])).slice(0, 7).trim();
  }

  private async getFirstCommit() {
    return (await this.spawnGit(["rev-list", "--max-parents=0", "HEAD"]))
      .slice(0, 7)
      .trim();
  }

  private async isAncestor(from: string, to: string) {
    /**
     * --is-ancestor
     * Check if the first <commit> is an ancestor of the second <commit>,
     * and exit with status 0 if true, or with status 1 if not.
     * Errors are signaled by a non-zero status that is not 1.
     */
    try {
      await this.spawnGit(["merge-base", "--is-ancestor", from, to]);
      return true;
    } catch {
      return false;
    }
  }

  private async getDistance(from: string, to: string) {
    return parseInt(
      (await this.spawnGit(["rev-list", "--count", `${from}..${to}`])).trim(),
      10
    );
  }

  protected async getAllBranches(): Promise<string[]> {
    return (await this.spawnGit(["branch", "-r"]))
      .trim()
      .split("\n")
      .map((s) => s.trim());
  }

  private async getNearestReleaseBranch(releaseBranches: Array<ReleaseBranch>) {
    let nearestReleaseBranch = {
      branch: this.DEFAULT_BRANCH,
      version: semver
        .parse(releaseBranches[releaseBranches.length - 1].version.format())!
        .inc("minor"),
    };
    for (const releaseBranch of releaseBranches) {
      const branchPointOfReleaseBranch = await this.getMergeBase(
        `origin/${this.DEFAULT_BRANCH}`,
        releaseBranch.branch
      );
      const branchPointOfHead = await this.getMergeBase(
        `origin/${this.DEFAULT_BRANCH}`,
        "HEAD"
      );
      if (branchPointOfReleaseBranch === branchPointOfHead) {
        nearestReleaseBranch = releaseBranch;
        break;
      }
    }

    return nearestReleaseBranch;
  }
}
