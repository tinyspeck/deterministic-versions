import { BaseVersioner } from "./version-base";
import { Octokit } from "@octokit/rest";

// TODO(erickzhao): implement github strategy

interface GitHubVersionerOptions {
  owner: string;
  repo: string;
}

export default class GitHubVersioner extends BaseVersioner {
  private gitHub = new Octokit();
  private owner: string;
  private repo: string;

  constructor(opts: GitHubVersionerOptions) {
    super();
    this.owner = opts.owner;
    this.repo = opts.repo;
  }

  public async getVersionForHead(): Promise<string> {
    const response = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${this.DEFAULT_BRANCH}...${"9e1e2e6"}`,
    });
    console.log(response);
    return "TODO";
  }

  public async getVersionForCommit(): Promise<string> {
    console.log(await this.getAllBranches());
    return "TODO";
  }

  public async getMASBuildVersion(): Promise<string> {
    return "TODO";
  }

  protected async getAllBranches() {
    const response = await this.gitHub.rest.repos.listBranches({
      owner: this.owner,
      repo: this.repo,
    });

    return response.data.map((branch) => branch.name);
  }

  private async getBranchForCommit(SHA: string) {
    const branches = [
      ...(await this.getReleaseBranches()).map((b) => b.branch),
      this.DEFAULT_BRANCH,
    ];
    const possibleReleaseBranches = [];

    for (const branch of branches) {
      await this.gitHub.rest.repos.compareCommitsWithBasehead({
        owner: this.owner,
        repo: this.repo,
        basehead: `${this.DEFAULT_BRANCH}...${branch}`,
      });
      // const response = await this.gitHub.rest.repos.listCommits({
      //   owner: this.owner,
      //   repo: this.repo,
      //   sha: branch,
      //   per_page: 100,
      // });

      // if (response.data.some((data) => data.sha.includes(SHA))) {
      //   possibleReleaseBranches.push(branch);
      // }
    }
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

    return possibleReleaseBranches[0];
  }
}
