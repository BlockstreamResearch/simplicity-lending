import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { checker } from 'vite-plugin-checker'

import { simplicitySourcesPlugin } from './plugins/simplicitySourcesPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    simplicitySourcesPlugin({
      configPath: './simplicity-covenants.config.json',
    }),
    react(),
    checker({
      overlay: {
        initialIsOpen: false,
        position: 'br',
      },
      typescript: true,
      eslint: {
        lintCommand: 'eslint .',
      },
    }),
  ],
  resolve: {
    alias: { '@': path.join(root, 'src') },
  },
  optimizeDeps: {
    exclude: ['@lilbonekit/lwk-web'],
  },
})
