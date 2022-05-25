import semver from "semver";
import { ReleaseBranch } from "./interfaces";

export abstract class BaseVersioner {
  protected abstract getAllBranches(): Promise<string[]>;
  protected abstract getBranchForCommit(sha: string): Promise<string>;
  protected abstract getHeadSHA(): Promise<string>;
  protected abstract getMergeBase(from: string, to: string): Promise<string>;

  protected DEFAULT_BRANCH: string = "main";
  protected releaseBranchMatcher =
    /^(?:origin\/)?release-([0-9]+)\.([0-9]+)\.x$/;
  protected UNSAFE_BRANCH_PATCH = 65535; // This is the highest possible build number for an appx build

  private cachedVersion: string | null = null;

  constructor() {}

  public async getVersionForHead() {
    const head = await this.getHeadSHA();
    console.error("Determined head commit:", head);
    return await this.getVersionForCommit(head);
  }

  public abstract getVersionForCommit(sha: string): Promise<string>;

  public async getMASBuildVersion() {
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
        this.releaseBranchMatcher.exec(branch.replace(/^origin\//, ""))
      )
      .filter((branch) => branch !== null) as RegExpExecArray[];

    return releaseBranchNames
      .map(([branchName, major, minor]) => {
        return {
          branch: branchName,
          version: semver.parse(`${major}.${minor}.0`)!,
        };
      })
      .sort((a, b) => {
        return a.version.compare(b.version);
      });
  }

  protected async getNearestReleaseBranch(
    releaseBranches: Array<ReleaseBranch>
  ) {
    let nearestReleaseBranch = {
      branch: this.DEFAULT_BRANCH,
      version: semver
        .parse(releaseBranches[releaseBranches.length - 1].version.format())!
        .inc("minor"),
    };
    for (const releaseBranch of releaseBranches) {
      const branchPointOfReleaseBranch = await this.getMergeBase(
        this.DEFAULT_BRANCH,
        releaseBranch.branch
      );
      const branchPointOfHead = await this.getMergeBase(
        this.DEFAULT_BRANCH,
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
