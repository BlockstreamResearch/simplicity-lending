import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import fs from 'fs'
import { defineConfig } from 'vite'
import { checker } from 'vite-plugin-checker'

const root = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  server: {
    fs: {
      allow: [root, path.resolve(root, '..', 'lwk_wasm', 'pkg_web')],
    },
  },
  plugins: [
    {
      name: 'lwk-wasm-dev',
      configureServer(server) {
        const wasmFile = path.resolve(root, '..', 'lwk_wasm', 'pkg_web', 'lwk_wasm_bg.wasm')
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next()
          if (!req.url.endsWith('lwk_wasm_bg.wasm')) return next()
          if (!fs.existsSync(wasmFile)) return next()
          res.setHeader('Content-Type', 'application/wasm')
          fs.createReadStream(wasmFile).pipe(res)
        })
      },
    },
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
