import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { checker } from 'vite-plugin-checker'

const root = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
})
