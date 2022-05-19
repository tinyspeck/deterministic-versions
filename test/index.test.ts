import path from "path";
import semver from "semver";
import LocalVersioner from "../src/version-local";

describe("Local Versioner", () => {
  const pathToRepo = path.join(__dirname, "..", "desktop-test-fixture");
  const v: LocalVersioner = new LocalVersioner({
    pathToRepo: pathToRepo,
    defaultBranch: "main",
  });

  beforeAll(() => {
    console.error = jest.fn();
  });

  it("generates the correct version from the default branch HEAD", async () => {
    const latestVersion = await v.getVersionForHead();
    expect(latestVersion).toBe("4.2.4");
  });

  it.each([
    ["the tip of a release branch (release-4.1.x)", "ece1c3f", "4.1.8"],
    ["a commit on a release branch (release-4.1.x)", "c95b710", "4.1.7"],
    ["from a different major version (release-3.2.x)", "21c5383", "3.2.3"],
    ["the first minor release branch (release-1.0.x)", "b2bcb99", "1.0.2"],
    ["the default branch before any release branches", "829eb2f", "0.0.1"],
    ["the branch point for a release branch", "4507940", "4.1.6"],
    [
      "a full length commit SHA",
      "dc328b57827d8619719f1783a21b05968652eaf3",
      "4.2.4",
    ],
  ])(
    "generates the correct version from %s",
    async (_, sha, expectedVersion) => {
      const version = await v.getVersionForCommit(sha);
      const parsed = semver.parse(version);
      expect(parsed?.version).toBe(expectedVersion);
    }
  );

  it.each([
    ["trunk", "499537a"],
    ["release branch", "57deab3"],
  ])("returns 65535 patch number for branch off of %s", async (_, sha) => {
    const version = await v.getVersionForCommit(sha);
    const parsed = semver.parse(version);
    expect(parsed?.patch).toBe(0xffff);
  });
});
