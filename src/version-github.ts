import { BaseVersioner } from './version-base';
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

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

      if (res.data.status === 'behind' || res.data.status === 'identical') {
        possibleBranches.push(branch);
      }
    }
    console.error(`Found release branch(es) [${possibleBranches.join(', ')}].`);

    possibleBranches.sort((a, b) => {
      if (a === this.DEFAULT_BRANCH) return -1;
      if (b === this.DEFAULT_BRANCH) return 1;
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const [, aMinor] = this.releaseBranchMatcher.exec(a)!;
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const [, bMinor] = this.releaseBranchMatcher.exec(b)!;
      return parseInt(aMinor, 10) - parseInt(bMinor, 10);
    });
    console.error(
      `Determined branch order [${possibleBranches.join(
        ', '
      )}]. Using first one.`
    );

    return possibleBranches[0];
  }

  protected async getMergeBase(from: string, to: string) {
    const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${from}...${to}`,
    });

    return res.data.merge_base_commit.sha.slice(0, 7).trim();
  }

  protected async isAncestor(from: string, to: string) {
    const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${from}...${to}`,
    });

    return res.data.status === 'ahead';
  }

  protected async getFirstCommit() {
    // No direct API for this. To do this in constant time, there's a workaround
    // involving some GraphQL-only APIs.
    // See https://stackoverflow.com/a/62336529/5602134 for information
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
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
      lastCommit.repository.ref.target.history.pageInfo.endCursor.split(' ')[0];
    const magicIncantation = `${lastCommitSHA} ${numCommits - 2}`;

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
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

  protected async getDistance(from: string, to: string) {
    const res = await this.gitHub.rest.repos.compareCommitsWithBasehead({
      owner: this.owner,
      repo: this.repo,
      basehead: `${from}...${to}`,
    });

    return res.data.total_commits;
  }
}
