import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// vitest runs with cwd = apps/api
const root = process.cwd();

export default defineConfig({
  // Route/service files use tsconfig `baseUrl` imports ("src/...") and ".js"
  // extensions on relative TS imports (NodeNext style). tsx resolves both at
  // runtime; these make Vitest's resolver do the same.
  resolve: {
    alias: [
      { find: /^src\//, replacement: resolve(root, 'src') + '/' },
      { find: '@funtush/database', replacement: resolve(root, '../../packages/database/src/index.ts') },
      { find: '@funtush/auth', replacement: resolve(root, '../../packages/auth/src/index.ts') },
    ],
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['node_modules'],
    // Load .env.test (docker-compose.test.yml infra) with .env as fallback.
    setupFiles: ['./vitest.setup.ts'],
  },
});
