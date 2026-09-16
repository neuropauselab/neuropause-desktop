/** Root ESLint config (classic config format for ESLint 8). */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'no-console': 'off',
    eqeqeq: ['error', 'smart'],
  },
  // S55 (F-S51-1): the certification sessions build into suffixed output dirs
  // (out-seam-*, out-run, dist-seam-*) that the bare 'dist'/'out' names never
  // matched, so `eslint .` drowned in minified bundle errors — a permanently red
  // verifier. Same generated-output class, same exclusion.
  ignorePatterns: ['dist', 'dist-*', 'out', 'out-*', 'build', 'release', 'node_modules', 'coverage', '*.cjs'],
};
