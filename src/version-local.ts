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
      /**
       * If we're on master then the version === {current_major}.{next_minor}.{commits_since_branch_of_last_minor}
       * We need to calculate next_minor though as this may be a commit between two minor releases
       * E.g.
       *
       * a -> b -> c -> d -> e -> f
       *      |              |
       *    R4.26          R4.27
       *
       * Given the commit "D" on master we should consider it 4.27 even though 4.27 has already been cut
       * because given its place in the tree it is BEFORE 4.27 was cut.  Commit order is what matters rather
       * than whatever happens to be the latest minor at the time the build was run.
       *
       * In order to determine this we go through every release branch and and check "is-ancestor" for the
       * merge-base of the release branch and master with the given commit.  The last release branch whose
       * branch point is an ancestor of our commit should have its minor incremented and used as the version
       * below.
       */
      let lastReleaseBranchWithAncestor = releaseBranches[0];
      for (const releaseBranch of releaseBranches) {
        let isAncestor = false;
        try {
          const releaseBranchPoint = await this.getMergeBase(
            releaseBranch.branch,
            `origin/${this.DEFAULT_BRANCH}`
          );
          // If we are literally on the merge point consider it not an ancestor
          if (releaseBranchPoint === sha) {
            isAncestor = false;
          } else {
            await this.getMergeBase(releaseBranchPoint, sha);
            isAncestor = true;
          }
        } catch {}
        if (!isAncestor) break;
        lastReleaseBranchWithAncestor = releaseBranch;
      }
      const currentMajor = lastReleaseBranchWithAncestor.version.major;
      const nextMinor = lastReleaseBranchWithAncestor.version.minor + 1;
      console.error(
        `On ${this.DEFAULT_BRANCH} so the version is considered to be the next unreleased minor`,
        `${currentMajor}.${nextMinor}`
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

      return `${currentMajor}.${nextMinor}.${commitsSinceLatestReleaseBranch}`;
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
        const firstCommit = (
          await this.spawnGit(["rev-list", "--max-parents=0", "HEAD"])
        ).trim();

        const commitsSinceInitialCommit = await this.getDistance(
          firstCommit,
          sha
        );

        return `${releaseBranch.version.major}.${releaseBranch.version.minor}.${commitsSinceInitialCommit}`;
      } else {
        const previousReleaseBranch = releaseBranches[releaseBranchIndex - 1];
        console.log(previousReleaseBranch.version, releaseBranch.version);
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
    return (await this.spawnGit(["merge-base", from, to])).trim();
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
    /**
     * Nearest release branch calculations
     *
     * a -> b -> c -> d -> h -> i -> j -> l -> m
     *           |                   |
     *           c -> e -> f         j -> k
     *                |
     *                e -> g
     *
     * In this example "C" and "J" are branch points for release branches and the top line is the master line
     *
     * In this scenario D and E are both one commit away from a branch point for a release branch and therefore
     * are quite hard to tell the difference between.  We however want to report the nearest release branch for
     * "D" as "J" and the nearest release branch for "E" as "C"
     *
     * The heuristic for this is that we just need to find a release branch whos merge-base with master is
     * the same as the merge-base of the current HEAD.  i.e. a single common ancestor exists such that it
     * is the branch point for both this commit and a release branch
     *
     * For the above case "G" has a merge-base of "C" and "F" (the tip of a release branch) has a merge-base of "C"
     * so the nearest release branch to "G" is "C->F"
     *
     * Importantly we don't need to worry about the case where HEAD is on master as that case never enters this code path
     * and is handled separately.
     */

    // If we're on a random branch the version number should obviously be garbage yet also be valid, a good middle ground is {nearest_major_branch}.{nearest_minor_branch}.65536
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
