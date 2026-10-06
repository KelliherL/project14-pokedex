import { fileURLToPath } from 'node:url';

import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { configs, plugins } from 'eslint-config-airbnb-extended';

// Resolved against this file, not the cwd
const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

const jsConfig = defineConfig([
  {
    name: 'js/config',
    ...js.configs.recommended,
  },
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,
]);

const reactConfig = defineConfig([
  plugins.react,
  plugins.reactHooks,
  plugins.reactA11y,
  ...configs.react.recommended,
]);

export default defineConfig([
  includeIgnoreFile(gitignorePath),
  ...jsConfig,
  ...reactConfig,
  {
    name: 'project/overrides',
    rules: {
      // React 17+ automatic JSX runtime
      'react/react-in-jsx-scope': 'off',
      '@stylistic/max-len': 'off',
      // Vite convention: explicit extensions on relative imports
      'import-x/extensions': ['error', 'ignorePackages', { js: 'always', jsx: 'always' }],
    },
  },
  {
    // Config files legitimately import devDependencies
    name: 'project/config-files',
    files: ['*.config.{js,mjs,cjs}', 'vite.config.js'],
    rules: {
      'import-x/no-extraneous-dependencies': 'off',
    },
  },
]);