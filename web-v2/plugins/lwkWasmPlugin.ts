import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

interface LwkWasmPluginOptions {
  wasmPath: string
}

export function lwkWasmPlugin(options: LwkWasmPluginOptions): Plugin {
  return {
    name: 'lwk-wasm',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) {
          return next()
        }

        if (!req.url.endsWith('lwk_wasm_bg.wasm')) {
          return next()
        }

        const wasmFile = path.resolve(options.wasmPath)

        if (!fs.existsSync(wasmFile)) {
          return next()
        }

        res.setHeader('Content-Type', 'application/wasm')

        fs.createReadStream(wasmFile).pipe(res)
      })
    },
  }
}
