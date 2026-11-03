import js from '@eslint/js';
import globals from 'globals';

// Correctness lint only: house style lives in review, not in rules.
export default [
  { ignores: ['**/node_modules/**', 'coverage/**', 'e2e/screens/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // The browser half runs in the board page.
  { files: ['public/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  // The e2e walk-through is Node, but its page.evaluate callbacks run in the page.
  { files: ['e2e/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
