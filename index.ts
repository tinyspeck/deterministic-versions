import LocalVersioner from "./src/version-local";

const main = async () => {
  const slackDesktop = "../slack/desktop";
  const v = new LocalVersioner(slackDesktop);

  const version = await v.getVersionForHead();
  console.log(version);
};

main();
