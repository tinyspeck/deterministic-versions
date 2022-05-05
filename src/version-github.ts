// TODO(erickzhao): implement github strategy
export default class GitHubVersioner extends BaseVersioner {
  constructor() {
    super();
  }

  public async getVersionForHead(): Promise<string> {
    return "TODO";
  }

  public async getMASBuildVersion(): Promise<string> {
    return "TODO";
  }
}
