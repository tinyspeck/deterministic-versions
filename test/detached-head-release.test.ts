import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import LocalVersioner from '../src/version-local';

describe('Release branch created at same commit as default branch', () => {
  let tmpDir: string;
  let headSha: string;

  beforeAll(() => {
    console.error = vi.fn();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-test-'));

    const git = (cmd: string) =>
      execSync(`git ${cmd}`, {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

    git('init -b main');
    git('config user.email "test@test.com"');
    git('config user.name "Test"');

    // Create initial history with a few commits
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), '1');
    git('add .');
    git('commit -m "Initial commit"');

    fs.writeFileSync(path.join(tmpDir, 'file.txt'), '2');
    git('add .');
    git('commit -m "Second commit"');

    // Create an older release branch so our new one isn't the "first-ever"
    git('branch release-4.49.x');

    fs.writeFileSync(path.join(tmpDir, 'file.txt'), '3');
    git('add .');
    git('commit -m "Third commit"');

    // Create release-4.50.x at the current tip of main
    git('branch release-4.50.x');

    headSha = git('rev-parse HEAD');

    // Simulate a remote by creating origin/ refs
    git('remote add origin ' + tmpDir);
    git('fetch origin');

    // Simulate CI detached HEAD on the release branch commit
    git('checkout --detach HEAD');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getMASBuildVersionForCommit returns a non-zero version', async () => {
    const v = new LocalVersioner({
      pathToRepo: tmpDir,
      defaultBranch: 'main',
    });

    const masVersion = await v.getMASBuildVersionForCommit(headSha);
    expect(masVersion).not.toBe('0');
    // Should be 450XXXXXX format (major=4, minor=50, patch padded to 6)
    expect(masVersion).toMatch(/^450\d{6}$/);
  });

  it('getVersionForCommit returns a release branch version', async () => {
    const v = new LocalVersioner({
      pathToRepo: tmpDir,
      defaultBranch: 'main',
    });

    const version = await v.getVersionForCommit(headSha);
    expect(version).toMatch(/^4\.50\.\d+$/);
  });
});
