import js from '@eslint/js';
import globals from 'globals';

/* Correctness only. The house style — comment density, spacing, the long
   explanatory blocks — is deliberate and not something a linter should have
   an opinion about. */
export default [
  { ignores: ['dist/', 'node_modules/'] },

  js.configs.recommended,

  {
    files: ['src/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  {
    // Vendored starter component: an IIFE full of patterns we don't own.
    files: ['src/client/vendor/**/*.js'],
    rules: { 'no-unused-vars': 'off', 'no-empty': 'off' },
  },

  {
    files: ['src/server/**/*.js', 'test/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    rules: {
      // `catch {}` with a comment explaining why is a deliberate idiom here.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
