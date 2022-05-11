import LocalVersioner from "./src/version-local";

const main = async () => {
  const v = new LocalVersioner({
    pathToRepo: "./desktop-test-fixture",
    defaultBranch: "main",
  });

  const version = await v.getVersionForHead();
  console.log(version);
};

main();
