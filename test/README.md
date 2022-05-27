# Testing

In order to test this algorithm, we have set up a fixture repo as a git submodule, available
at [erickzhao/desktop-test-fixture](https://github.com/erickzhao/desktop-test-fixture). The
repository simulates the regular release branch process for Slack Desktop.

The same test assertions are run for both the GitHub and Git strategies to ensure parity
between both algorithms.

## Git history

The output from `git log --all --decorate --oneline --graph` is:

```
* b2bcb99 (origin/release-1.0.x, release-1.0.x) chore: empty commit
| * 21c5383 (origin/release-3.2.x, release-3.2.x) chore: empty commit
| | * 57deab3 (origin/fix/new-bug-fix, fix/new-bug-fix) chore: empty commit
| | * a503c76 (origin/release-4.0.x, release-4.0.x) fix: important security backport
| | * 9892463 fix: backportable fix! (will go into 4.0.x)
| | * 03bae72 fix: 4.0.x specific fix
| | * 268f25e fix: fix i need to backport
| | | * 499537a (origin/feat/new-feature-branch, feat/new-feature-branch) chore: empty commit
| | | * dc328b5 (HEAD -> main, origin/main, origin/HEAD) chore: swap out CI providers
| | | * 1b9c427 feat: add new shiny feature 2
| | | * 1835c2d feat: add new shiny feature
| | | * 7842465 fix: important security backport
| | | | * ece1c3f (origin/release-4.1.x, release-4.1.x) fix: important security backport
| | | | * c95b710 fix: 4.1.x-only fix
| | | |/  
| | | * 4507940 chore: main branch commit!
| | | * f518e9b feat: another new feature
| | | * a8e1d1a fix: backportable fix! (will go into 4.0.x)
| | | * e30b8b5 feat: another new feature (no bp)!!
| | | * cd5a085 feat: a new feature wow!! (not backported)
| | | * da7c537 fix: fix i need to backport
| | |/  
| | * 9e1e2e6 docs: add initial API documentation
| |/  
| * 3a159f0 fix: plug security leak
| * c26d9ba feat: add cross-platform functionality
|/  
* 829eb2f feat: initial feature work
* eba3360 Initial commit
```

## Test cases

See `index.test.ts` for the full details of the test cases.

* Any commit residing on the default branch or any release branch should
  have a valid major.minor.patch version number assigned to it. 
* Any commit not fitting the above criteria should have patch version `0xffff`.

| Case                                | SHA     | Version   |
|-------------------------------------|---------|-----------|
| Tip of release branch               | ece1c3f | 4.1.8     |
| Commit on release branch            | c95b710 | 4.1.7     |
| Older release branch                | 21c5383 | 3.2.3     |
| Oldest release branch               | b2bcb99 | 1.0.2     |
| Branch point for release branch     | 4507940 | 4.1.6     |
| Default branch before any releases  | 829eb2f | 0.0.1     |
| Commit branched from release branch | 57deab3 | 4.0.65535 |
| Commit branched from default branch | 499537a | 4.2.65535 |
