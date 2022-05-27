import { SemVer } from 'semver';

export interface ReleaseBranch {
  branch: string;
  version: SemVer;
}
