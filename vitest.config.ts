import path from 'path';
import { defineConfig, defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

const workspaceAliases = [
  {
    find: /^@18ways\/core$/,
    replacement: path.resolve(__dirname, '../18ways-core/index.ts'),
  },
  {
    find: /^@18ways\/core\/(.*)$/,
    replacement: path.resolve(__dirname, '../18ways-core/$1'),
  },
] as const;

const resolve = {
  dedupe: ['react', 'react-dom'],
  alias: [...workspaceAliases],
};

const coverage = {
  provider: 'v8' as const,
};

const sharedTestConfig = {
  exclude: ['node_modules/**', '**/e2e/**'],
  coverage,
};

export default defineConfig({
  plugins: [react()],
  resolve,
  test: {
    ...sharedTestConfig,
    projects: [
      defineProject({
        resolve,
        test: {
          ...sharedTestConfig,
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.test.ts', 'tests/ways-seed-gating.test.tsx'],
          setupFiles: ['./vitest-setup.ts'],
        },
      }),
      defineProject({
        resolve,
        test: {
          ...sharedTestConfig,
          name: 'jsdom',
          environment: 'jsdom',
          globals: true,
          include: ['tests/**/*.test.tsx'],
          exclude: ['tests/ways-seed-gating.test.tsx'],
          setupFiles: ['./vitest-setup.ts'],
        },
      }),
    ],
  },
});
