#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { program } from 'commander';
import LocalVersioner from './src/version-local';
import packageJSON from './package.json';

async function main() {
  program
    .name('deterministic-versions')
    .description('Deterministic git-based versioning for applications')
    .version(packageJSON.version, '-v, --version', 'Output the version of this CLI (not the target repository)')
    .option('-r, --repo-path <char>', 'Path to the local git repository')
		.option('-s, --silent', 'Run the program without any output')
    .option(
      '-d, --default-branch <char>',
      'Name of the default branch of the repository'
    )
    .option(
      '-o, --output-file <char>',
      'If specified, writes the version number to the specified file'
    );

  program.parse();
  const options = program.opts();

  const v = new LocalVersioner({
    pathToRepo: options.repoPath,
    defaultBranch: options.defaultBranch,
  });

  const version = await v.getVersionForHead();
  if (typeof options.outputFile === 'string') {
    const out = path.resolve(options.outputFile);
    fs.writeFileSync(out, version);
  }
}

main();
