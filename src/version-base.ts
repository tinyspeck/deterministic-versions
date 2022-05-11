import semver from "semver";
import { ReleaseBranch } from "./interfaces";

export abstract class BaseVersioner {
  abstract getVersionForHead(): Promise<string>;
  abstract getVersionForCommit(sha: string): Promise<string>;
  abstract getMASBuildVersion(): Promise<string>;
  protected abstract getAllBranches(): Promise<string[]>;

  protected DEFAULT_BRANCH: string = "main";
  protected releaseBranchMatcher = /^(?:origin\/)?release-4\.([0-9]+)\.x$/;
  protected UNSAFE_BRANCH_PATCH = 65535; // This is the highest possible build number for an appx build

  private cachedVersion: string | null = null;

  constructor() {}

  protected async getVersionForHeadCached() {
    if (this.cachedVersion === null) {
      this.cachedVersion = await this.getVersionForHead();
    }
    return this.cachedVersion;
  }

  protected async getReleaseBranches(): Promise<ReleaseBranch[]> {
    const allBranches = await this.getAllBranches();
    const releaseBranchNames = allBranches.filter((branch) =>
      this.releaseBranchMatcher.test(branch.replace(/^origin\//, ""))
    );
    return releaseBranchNames
      .map((branchName) => {
        return {
          branch: branchName,
          version: semver.parse(
            `4.${
              this.releaseBranchMatcher.exec(
                branchName.replace(/^origin\//, "")
              )![1]
            }.0`
          )!,
        };
      })
      .sort((a, b) => {
        return a.version.compare(b.version);
      });
  }
}
