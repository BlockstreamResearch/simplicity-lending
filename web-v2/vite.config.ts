import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { checker } from 'vite-plugin-checker'

import { lwkWasmPlugin } from './plugins/lwkWasmPlugin'
import { simplicitySourcesPlugin } from './plugins/simplicitySourcesPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  server: {
    fs: {
      allow: [root, path.resolve(root, '..', 'lwk_wasm', 'pkg_web')],
    },
  },
  plugins: [
    simplicitySourcesPlugin({
      configPath: './simplicity-covenants.config.json',
    }),

    lwkWasmPlugin({
      wasmPath: '../lwk_wasm/pkg_web/lwk_wasm_bg.wasm',
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
})
