import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.cache/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['packages/game-engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            'react',
            'react/*',
            'fastify',
            'socket.io*',
            'pg',
            'drizzle-orm*',
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'fetch',
        'Date',
        'setTimeout',
        'setInterval',
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject deterministic randomness.',
        },
      ],
    },
  },
  prettier,
);
