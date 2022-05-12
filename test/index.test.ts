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

  it("fetches the version from the default branch", async () => {
    const latestVersion = await v.getVersionForHead();
    expect(latestVersion).toBe("4.2.4");
  });

  it("returns 65535 patch number for feature branch off of trunk", async () => {
    const version = await v.getVersionForCommit("499537a");
    const parsed = semver.parse(version);
    expect(parsed?.patch).toBe(0xffff);
  });

  it("returns 65535 patch number for feature branch off of release branch", async () => {
    const version = await v.getVersionForCommit("57deab3");
    const parsed = semver.parse(version);
    expect(parsed?.patch).toBe(0xffff);
  });
});
