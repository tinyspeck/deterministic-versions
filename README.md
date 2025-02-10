# Desktop Development Deterministic Denomination

[![CircleCI](https://circleci.com/gh/tinyspeck/deterministic-versions.svg?style=shield)](https://circleci.com/gh/tinyspeck/deterministic-versions)
![npm](https://img.shields.io/npm/v/deterministic-versions)

This package provides an algorithm that deterministically generates a `major.minor.build`
versioning system for desktop applications given the git history of the repository.

## Progammatic usage

TODO

## CLI usage

```
Usage: deterministic-versions [options]

Deterministic git-based versioning for applications

Options:
  -V, --version                output the version number
  -r, --repo-path <char>       Path to the local git repository
  -s, --silent                 Run the program without any output
  -d, --default-branch <char>  Name of the trunk branch of the repository
  -o, --output-file <char>     If specified, writes the version number to the specified file
  -h, --help                   display help for command
```

## Algorithm overview

This versioning algorithm relies on a git repository with user-defined release branches
(by default, `release-MAJOR.MINOR.x`). It collects a list of all these branches and generates
a unique `BUILD` number for each commit SHA in the repository.

In general, the number for each commit will depend on its position on the release branch or default
branch relative to the last branch point. To determine what ordering (e.g. "last" or "next") means
in this context, all release branches will be sorted linearly according to SemVer comparison.

## Detailed versioning logic

### On the default branch

For any commit on the default branch, we take the major and minor numbers from the **next** release
branch and count the number of commits since the **last** release branch was cut.

```
{current_major}.{next_minor}.{commits_since_branch_of_last_minor}
```

To illustrate, take the following git history:

```plaintext
a -> b -> c -> d -> e -> f
      \              \
     R4.26...       R4.27...
```

- Commit **`d`** will be version `4.27.2`. We consider it to be `4.27` since it exists in the
  version history before the `R4.27` (next) branch was cut (on commit `e`). The build number will
  be `2` since `d` is 2 commits after the `R4.26` (last) branch was cut (on commit `b`).
- Commit **`f`** will be version `4.28.1`. We consider it to be `4.28` since it exists in the
  version history after the most recent branch was cut (on commit `e`). The build number will
  be `1` since `d` is 2 commits after the last branch was cut (on commit `e`).

In the code, we use [`git merge-base`](https://git-scm.com/docs/git-merge-base)
between the branch point for each release branch and our commit to check if that point is a parent
of the commit. The last release branch whose branch point is an ancestor of our commit should have
its minor incremented and used as the version for our commit.

### On a release branch

If the commit is on is a release branch, we directly take the major and minor versions of the
current branch and, similarly to the last case, count the number of commits since the **last** release
branch was cut.

```
{current_major}.{current_minor}.{commits_since_branch_of_last_minor}
```

To illustrate, take the following git history:

```plaintext
a -> b -> c -> d -> e -> f
      \              \
     R4.26          R4.27
        \-> x -> y     \
                        \-> q -> r -> s -> t
```

- Commit **`r`** will be version `4.27.5`. It takes the current release branch major (4) and minor (27),
  and counts the number of commits since the R4.26 (last) branch was cut at commit `b`.
- Notice that because of the above two rules, the versioning for the default branch into a corresponding
  release branch is continuous (e.g. commit `e` is `4.27.3` while commit `q` is `4.27.4`).

### On neither the default branch or a release branch

If we are on a commit that does not match either of the above cases, we still want to assign it a
parseable version number (but one that is obviously not a real release). For this, we chose 65535
(or `0xFFFF` in hexadecimal) as the patch number since it's the max build number for Microsoft
Store apps.

> Note: This means that multiple commits will have the same version number, which is okay because
> we will never publish from a non-default/non-release branch, so we don't care about duplicates.

To determine which major and minor are associated with this commit, we calculate the nearest
release branch to our commit. This is done

1. If the current commit and a release branch have the same merge-base to the default branch
   (i.e. the release branch is an ancestor to the current commit), that branch is considered the
   nearest to the current commit.
1. If the current commit does not share a merge-base to the default branch with any release branch.
   (i.e. no release branch is an ancestor to the current commit), the **default branch** will be
   considered the nearest to the current commit.

From there, the build version for the target commit will be:

```
{nearest_major}.{nearest_minor}.65535
```

To illustrate, take the below commit history:

```plaintext
a -> b -> c -> d -> h -> i -> j -> l -> m -> n -> p -> q
           \                   \              \
          R4.26               R4.27           fix
             \-> e -> f          \              \
                  \               \-> k          \-> o
                  feat
                    \-> g
```

- commit `g`'s merge-base to the default branch is commit `c`, which is the same as the merge-base to
  the default branch for R4.26 branch (commit `f`). It has version number `4.26.65535`.
- commit `o` does not share a common default branch merge-base with any release branch, so the nearest
  branch will be the default branch. It has version number `4.28.65535`.
