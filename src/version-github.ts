import { BaseVersioner } from './version-base';
import { Octokit } from '@octokit/rest';
import type { OctokitOptions } from '@octokit/core';

interface GitHubVersionerOptions {
  owner: string;
  repo: string;
  defaultBranch?: string;
  authOptions?: OctokitOptions['auth'];
}

export default class GitHubVersioner extends BaseVersioner {
  private gitHub: Octokit;
  private owner: string;
  private repo: string;

  constructor(opts: GitHubVersionerOptions) {
    super();
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.defaultBranch = opts.defaultBranch || 'main';
    this.gitHub = new Octokit({ auth: opts.authOptions });
  }

  protected async getHeadSHA(): Promise<string> {
    const response = await this.gitHub.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref: this.defaultBranch,
    });

    return response.data.sha;
  }

  /**
   * Fetches all branches in the GitHub repository via the
   * `/repos/{owner}/{repo}/branches` endpoint. Uses pagination
   * via Octokit to ensure all branches are fetched.
   */
  protected async getAllBranches() {
    type Branch = Awaited<
      ReturnType<Octokit['rest']['repos']['listBranches']>
    >['data'][number];
    const response: Branch[] = await this.gitHub.paginate(
      '/repos/{owner}/{repo}/branches',
      {
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    return response.map((branch: Branch) => branch.name);
  }

  protected async getBranchForCommit(SHA: string) {
    const branches = [
      ...(await this.getReleaseBranches()).map((b) => b.branch),
      this.defaultBranch,
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
    if (!this.silent)
      console.error(
        `Found release branch(es) [${possibleBranches.join(', ')}].`
      );

    possibleBranches.sort((a, b) => {
      if (a === this.defaultBranch) return -1;
      if (b === this.defaultBranch) return 1;
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const [, aMinor] = this.releaseBranchMatcher.exec(a)!;
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      const [, bMinor] = this.releaseBranchMatcher.exec(b)!;
      return parseInt(aMinor, 10) - parseInt(bMinor, 10);
    });
    if (!this.silent)
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
          ref(qualifiedName: "${this.defaultBranch}") {
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
          ref(qualifiedName: "${this.defaultBranch}") {
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
