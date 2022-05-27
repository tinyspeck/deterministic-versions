import LocalVersioner from './src/version-local';
import GitHubVersioner from './src/version-github';

export const Versioner = {
  Local: LocalVersioner,
  GitHub: GitHubVersioner,
};
