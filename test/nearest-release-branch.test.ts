import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import LocalVersioner from '../src/version-local';

/**
 * Exercises version computation in a repo with several release branches,
 * covering the non-release-branch path that getNearestReleaseBranchForSHA
 * drives. The fixture is a real git repo so the git subprocess reads run
 * for real.
 */
describe('Version computation with multiple release branches', () => {
  let tmpDir: string;
  let git: (cmd: string) => string;

  let mainTipSha: string;
  let release42TipSha: string;
  let branchedFrom41Sha: string;
  let branchedFrom42Sha: string;

  beforeAll(() => {
    console.error = vi.fn();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-nearest-'));

    git = (cmd: string) =>
      execSync(`git ${cmd}`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

    const commit = (content: string, message: string) => {
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), content);
      git('add .');
      git(`commit -m "${message}"`);
      return git('rev-parse HEAD');
    };

    git('init -b main');
    git('config user.email "test@test.com"');
    git('config user.name "Test"');

    // main history, branching a release branch off the tip at each minor.
    commit('1', 'c1');
    commit('2', 'c2');
    git('branch release-4.0.x');

    commit('3', 'c3');
    const branchPoint41 = git('rev-parse HEAD');
    git('branch release-4.1.x');

    commit('4', 'c4');
    git('branch release-4.2.x');
    release42TipSha = git('rev-parse HEAD');

    commit('5', 'c5');
    mainTipSha = git('rev-parse HEAD');

    // A feature branch off the release-4.1.x branch point (still on main).
    git(`checkout -b feature-from-41 ${branchPoint41}`);
    branchedFrom41Sha = commit('f41', 'feature off 4.1 branch point');

    // A feature branch off the release-4.2.x branch point.
    git(`checkout -b feature-from-42 ${release42TipSha}`);
    branchedFrom42Sha = commit('f42', 'feature off 4.2 branch point');

    git('checkout main');

    // Simulate a remote so origin/* refs resolve like a real checkout.
    git(`remote add origin ${tmpDir}`);
    git('fetch origin');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeVersioner = () =>
    new LocalVersioner({ pathToRepo: tmpDir, defaultBranch: 'main' });

  it('generates the next-minor version on the default branch', async () => {
    const version = await makeVersioner().getVersionForCommit(mainTipSha);
    // Newest release branch is 4.2.x, so main is the unreleased 4.3.
    expect(version).toMatch(/^4\.3\.\d+$/);
  });

  it('generates the release-branch version on a release branch tip', async () => {
    const version = await makeVersioner().getVersionForCommit(release42TipSha);
    expect(version).toMatch(/^4\.2\.\d+$/);
  });

  it('uses the nearest release branch on a non-release branch (4.1 branch point)', async () => {
    const version =
      await makeVersioner().getVersionForCommit(branchedFrom41Sha);
    expect(version).toBe('4.1.65535');
  });

  it('uses the nearest release branch on a non-release branch (4.2 branch point)', async () => {
    const version =
      await makeVersioner().getVersionForCommit(branchedFrom42Sha);
    expect(version).toBe('4.2.65535');
  });
});
