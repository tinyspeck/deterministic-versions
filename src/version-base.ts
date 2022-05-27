import semver from 'semver';
import { ReleaseBranch } from './interfaces';

export abstract class BaseVersioner {
  protected abstract getAllBranches(): Promise<string[]>;
  protected abstract getBranchForCommit(sha: string): Promise<string>;
  protected abstract getDistance(from: string, to: string): Promise<number>;
  protected abstract getFirstCommit(): Promise<string>;
  protected abstract getHeadSHA(): Promise<string>;
  protected abstract getMergeBase(from: string, to: string): Promise<string>;
  protected abstract isAncestor(from: string, to: string): Promise<boolean>;

  protected DEFAULT_BRANCH = 'main';
  protected releaseBranchMatcher =
    /^(?:origin\/)?release-([0-9]+)\.([0-9]+)\.x$/;

  protected UNSAFE_BRANCH_PATCH = 65535; // This is the highest possible build number for an appx build

  private cachedVersion: string | null = null;

  public async getVersionForHead() {
    const head = await this.getHeadSHA();
    console.error('Determined head commit:', head);
    return await this.getVersionForCommit(head);
  }

  public async getVersionForCommit(sha: string) {
    const currentBranch = await this.getBranchForCommit(sha);
    console.error('Determined branch for commit:', currentBranch);

    const releaseBranches = await this.getReleaseBranches();

    if (currentBranch === this.DEFAULT_BRANCH) {
      let lastReleaseBranchWithAncestor;
      for (const releaseBranch of releaseBranches) {
        let isAncestor = false;
        const releaseBranchPoint = await this.getMergeBase(
          releaseBranch.branch,
          this.DEFAULT_BRANCH
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
          this.DEFAULT_BRANCH,
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
        (branch) => branch.branch === currentBranch.replace(/^origin\//, '')
      );
      const releaseBranch = releaseBranches[releaseBranchIndex];

      if (!releaseBranch) {
        throw new Error(
          'Failed to find remote branch for current release branch, ensure it is pushed to the remote'
        );
      }

      console.error(
        'On an active release branch so the version is considered to be the current minor',
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
          'Determined previous release branch to be:',
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
          'Calculated that there were',
          commitsOnDefaultBranchBetweenReleases,
          'commits on the',
          this.DEFAULT_BRANCH,
          'branch between the previous release and this release'
        );

        const commitsInCurrentRelease = await this.getDistance(
          firstCommitInCurrentRelease,
          sha
        );
        console.error(
          'Calculated that there are',
          commitsInCurrentRelease,
          'commits on the',
          currentBranch,
          'branch since its inception till',
          sha
        );

        return `${releaseBranch.version.major}.${releaseBranch.version.minor}.${
          commitsInCurrentRelease + commitsOnDefaultBranchBetweenReleases
        }`;
      }
    } else {
      // If we're on a random branch the version number should obviously be garbage yet also be valid, a good middle ground is {nearest_major_branch}.{nearest_minor_branch}.65535
      const nearestReleaseBranch = await this.getNearestReleaseBranchForSHA(
        releaseBranches,
        sha
      );

      console.error(
        'On a non-release branch, determined the nearest release branch is:',
        nearestReleaseBranch.branch
      );
      return `${nearestReleaseBranch.version.major}.${nearestReleaseBranch.version.minor}.${this.UNSAFE_BRANCH_PATCH}`;
    }
  }

  public async getMASBuildVersion() {
    const zeroPad = (n: number, width: number) => {
      return `${n}`.padStart(width, '0');
    };
    const currentBranch = await this.getBranchForCommit(
      await this.getHeadSHA()
    );
    if (this.releaseBranchMatcher.test(currentBranch)) {
      const version = await this.getVersionForHeadCached();
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const parsedVersion = semver.parse(version)!;
      // 4.26.123
      // 426000123
      return `${parsedVersion.major}${zeroPad(parsedVersion.minor, 2)}${zeroPad(
        parsedVersion.patch,
        6
      )}`;
    }
    // If we aren't on a release branch we should return a buildVersion that can not be released
    return '0';
  }

  protected async getVersionForHeadCached() {
    if (this.cachedVersion === null) {
      this.cachedVersion = await this.getVersionForHead();
    }
    return this.cachedVersion;
  }

  protected async getReleaseBranches(): Promise<ReleaseBranch[]> {
    const allBranches = await this.getAllBranches();
    const releaseBranchNames = allBranches
      .map((branch) =>
        this.releaseBranchMatcher.exec(branch.replace(/^origin\//, ''))
      )
      .filter((branch) => branch !== null) as RegExpExecArray[];

    return releaseBranchNames
      .map(([branchName, major, minor]) => {
        return {
          branch: branchName,
          /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
          version: semver.parse(`${major}.${minor}.0`)!,
        };
      })
      .sort((a, b) => {
        return a.version.compare(b.version);
      });
  }

  protected async getNearestReleaseBranchForSHA(
    releaseBranches: Array<ReleaseBranch>,
    sha: string
  ) {
    let nearestReleaseBranch = {
      branch: this.DEFAULT_BRANCH,
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      version: semver
        .parse(releaseBranches[releaseBranches.length - 1].version.format())!
        .inc('minor'),
    };
    for (const releaseBranch of releaseBranches) {
      const branchPointOfReleaseBranch = await this.getMergeBase(
        this.DEFAULT_BRANCH,
        releaseBranch.branch
      );
      const branchPointOfSHA = await this.getMergeBase(
        this.DEFAULT_BRANCH,
        sha
      );
      if (branchPointOfReleaseBranch === branchPointOfSHA) {
        nearestReleaseBranch = releaseBranch;
        break;
      }
    }

    return nearestReleaseBranch;
  }
}
