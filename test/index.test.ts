import path from "path";
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
});
