module.exports = {
  env: {
    node: true,
  },
  root: true,
  ignorePatterns: ['desktop-test-fixture'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
};
