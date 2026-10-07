import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // the client's own code (client/test) reads shared code as the client does
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  test: {
    include: ['shared/**/*.test.ts', 'server/test/**/*.test.ts', 'client/test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
