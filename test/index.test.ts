import path from 'path';
import * as semver from 'semver';
import LocalVersioner from '../src/version-local';
import GitHubVersioner from '../src/version-github';
import dotenv from 'dotenv';

dotenv.config();

jest.setTimeout(30000);

const lv: LocalVersioner = new LocalVersioner({
  pathToRepo: path.join(__dirname, '..', 'desktop-test-fixture'),
  defaultBranch: 'main',
});

const gv: GitHubVersioner = new GitHubVersioner({
  owner: 'erickzhao',
  repo: 'desktop-test-fixture',
  authOptions: process.env.GITHUB_TOKEN,
});

describe.each([
  ['Local Versioner', lv],
  ['GitHub Versioner', gv],
])('%s', (_, v) => {
  beforeAll(() => {
    console.error = jest.fn();
  });

  it('generates the correct version from the default branch HEAD', async () => {
    const latestVersion = await v.getVersionForHead();
    expect(latestVersion).toBe('4.2.4');
  });

  it.each([
    ['the tip of a release branch (release-4.1.x)', 'ece1c3f', '4.1.8'],
    ['a commit on a release branch (release-4.1.x)', 'c95b710', '4.1.7'],
    ['from a different major version (release-3.2.x)', '21c5383', '3.2.3'],
    ['the first minor release branch (release-1.0.x)', 'b2bcb99', '1.0.2'],
    ['the default branch before any release branches', '829eb2f', '0.0.1'],
    ['the branch point for a release branch', '4507940', '4.1.6'],
    [
      'the branch point for a release branch with a full SHA',
      '45079400b565b91a146a1699d50da9d2d4170a33',
      '4.1.6',
    ],
    [
      'the commit after the branch point for a release branch on a release branch',
      'c95b710',
      '4.1.7',
    ],
    [
      'the commit after the branch point for a release branch on the mainline branch',
      '7842465',
      '4.2.1',
    ],
    ['commit branched from trunk', '499537a', '4.2.65535'],
    ['commit branched from release branch', '57deab3', '4.0.65535'],
    [
      'a full length commit SHA',
      'dc328b57827d8619719f1783a21b05968652eaf3',
      '4.2.4',
    ],
  ])(
    'generates the correct version from %s',
    async (_, sha, expectedVersion) => {
      const version = await v.getVersionForCommit(sha);
      const parsed = semver.parse(version);
      expect(parsed?.version).toBe(expectedVersion);
    }
  );

  it('generates the correct MAS build version number for HEAD', async () => {
    const res = await v.getMASBuildVersionForHEAD();
    expect(res).toBe('0');
  });

  it('generates the correct MAS build version number for commit', async () => {
    const res = await v.getMASBuildVersionForCommit('ece1c3f');
    expect(res).toBe('401000008');
  });
});
