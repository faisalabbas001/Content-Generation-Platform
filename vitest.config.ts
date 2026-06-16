import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/vitest.setup.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // `server-only` is a Next.js marker — stub it out in tests.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
      '@repo/auth/slug': resolve(__dirname, 'packages/auth/src/slug.ts'),
      '@repo/auth/proxy': resolve(__dirname, 'packages/auth/src/proxy/index.ts'),
      '@repo/auth/admin': resolve(__dirname, 'packages/auth/src/admin/index.ts'),
      '@repo/auth/server': resolve(__dirname, 'packages/auth/src/server/index.ts'),
      '@repo/auth/types': resolve(__dirname, 'packages/auth/src/types.ts'),
      '@repo/auth': resolve(__dirname, 'packages/auth/src/index.ts'),
      '@repo/memory': resolve(__dirname, 'packages/memory/src/index.ts'),
      '@repo/memory/types': resolve(__dirname, 'packages/memory/src/types.ts'),
    },
  },
})
