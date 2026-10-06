import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

import { simplicitySourcesPlugin } from './plugins/simplicitySourcesPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * The test run, kept separate from `vite.config.ts` on purpose.
 *
 * The dev config carries a typecheck-and-lint overlay, which duplicates two gates that already
 * run on their own. The Simplicity source loader is here as well as there, because it stopped
 * being loader-for-code-no-test-reaches: the request the wallet performs an action from carries
 * the contract sources, and a test that stood them in would prove a request nobody sends.
 */
export default defineConfig({
  plugins: [simplicitySourcesPlugin({ configPath: './simplicity-covenants.config.json' }), react()],
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    /*
     * Pinned rather than loaded from a `.env` file, so a test asserts what this configuration
     * says and not what happens to be on the machine running it. The network is the one the
     * bundle targets; the waterfalls URL has no default and is never called from a test.
     */
    env: {
      VITE_NETWORK: 'liquidtestnet',
      VITE_WATERFALLS_URL: 'https://waterfalls.invalid',
    },
  },
})
