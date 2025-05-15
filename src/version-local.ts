import { spawn } from '@malept/cross-spawn-promise';
import path from 'node:path';
import fs from 'node:fs';
import { BaseVersioner } from './version-base';

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

    this.defaultBranch = opts.defaultBranch || 'main';

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
    return spawn('git', command, { cwd: this.pathToRepo });
  }

  protected async getHeadSHA() {
    return (await this.spawnGit(['rev-parse', 'HEAD'])).trim();
  }

  protected async getBranchForCommit(SHA: string) {
    const possibleBranches = (
      await this.spawnGit(['branch', '--contains', SHA, '--remote'])
    )
      .trim()
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => !b.includes(' -> '))
      .map((b) => b.replace(/^origin\//, ''));

    const possibleReleaseBranches = possibleBranches.filter(
      (branch) =>
        this.releaseBranchMatcher.test(branch) || branch === this.defaultBranch
    );

    // If we're searching for the current HEAD, prioritize the current
    // branch over other branches with the same commit.
    const currentBranch = (
      await this.spawnGit(['rev-parse', '--abbrev-ref', 'HEAD'])
    ).trim();

    const head = await this.getHeadSHA();

    if (
      head.slice(0, 7) === SHA.slice(0, 7) &&
      possibleBranches.includes(currentBranch)
    ) {
      return currentBranch;
    }

    if (!this.silent)
      console.error(
        `Found release branch(es) [${possibleReleaseBranches.join(', ')}].`
      );
    possibleReleaseBranches.sort((a, b) => {
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
        `Determined branch order [${possibleReleaseBranches.join(
          ', '
        )}]. Using first one.`
      );
    return possibleReleaseBranches[0];
  }

  protected async getMergeBase(from: string, to: string) {
    // If we're referring to the main branch, we want to get the
    // upstream tip-of-tree rather than the local checkout.
    // For example, this matters if we're on a detached HEAD
    // on the main branch.
    const fixedFrom =
      (from === this.defaultBranch || this.releaseBranchMatcher.test(from)) &&
      !from.startsWith('origin/')
        ? `origin/${from}`
        : from;
    const fixedTo =
      (to === this.defaultBranch || this.releaseBranchMatcher.test(to)) &&
      !to.startsWith('origin/')
        ? `origin/${to}`
        : to;

    return (await this.spawnGit(['merge-base', fixedFrom, fixedTo]))
      .slice(0, 7)
      .trim();
  }

  protected async getFirstCommit() {
    return (await this.spawnGit(['rev-list', '--max-parents=0', 'HEAD']))
      .slice(0, 7)
      .trim();
  }

  protected async isAncestor(from: string, to: string) {
    /**
     * --is-ancestor
     * Check if the first <commit> is an ancestor of the second <commit>,
     * and exit with status 0 if true, or with status 1 if not.
     * Errors are signaled by a non-zero status that is not 1.
     */
    try {
      await this.spawnGit(['merge-base', '--is-ancestor', from, to]);
      return true;
    } catch {
      return false;
    }
  }

  protected async getDistance(from: string, to: string) {
    return parseInt(
      (await this.spawnGit(['rev-list', '--count', `${from}..${to}`])).trim(),
      10
    );
  }

  protected async getAllBranches(): Promise<string[]> {
    return (await this.spawnGit(['branch', '-r']))
      .trim()
      .split('\n')
      .map((s) => s.trim());
  }
}
