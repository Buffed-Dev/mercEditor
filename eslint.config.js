// Flat config. Deliberately small: this is a lint pass for real mistakes
// (unused imports, duplicate keys, undeclared globals), not a style engine.
// Formatting is not linted because nothing here formats automatically.
import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const unused = ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }];

export default [
  { ignores: ['dist/**', 'node_modules/**', 'Games/*/rules/vfx.js'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': unused,
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // React, in the editor's interface only. The rules-of-hooks check is the one
  // that catches a real bug rather than a style opinion: a hook called
  // conditionally reads the wrong state on the next render, silently.
  {
    files: ['Engine/editor/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // TypeScript only. The typed rules are scoped rather than applied to
  // everything, because the base no-unused-vars reads parameter names inside a
  // type signature as unused variables — and running both reports every real
  // finding twice.
  ...ts.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unused,
      // Both are warnings in `recommended`, which means a stray `any` scrolls
      // past in a hundred lines of output instead of failing the build. The
      // whole TypeScript surface here is written without either, and the only
      // way that stays true through the rest of the migration is if breaking
      // it is an error. An escape hatch that costs a conversation is fine; one
      // that costs nothing is not an invariant.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
];
