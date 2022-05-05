export abstract class BaseVersioner {
  abstract getVersionForHead(): Promise<string>;
  abstract getMASBuildVersion(): Promise<string>;

  protected DEFAULT_BRANCH = "master";
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
}
