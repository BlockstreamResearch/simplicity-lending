import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const SIMPLICITY_SOURCES_VIRTUAL = '\0virtual:simplicity-sources'

function simplicitySourcesPlugin() {
  let repoRoot: string
  return {
    name: 'simplicity-sources',
    configResolved(config: { root: string }) {
      repoRoot = path.resolve(config.root, '..')
    },
    resolveId(id: string) {
      if (id === 'virtual:simplicity-sources') return SIMPLICITY_SOURCES_VIRTUAL
      return null
    },
    load(id: string) {
      if (id !== SIMPLICITY_SOURCES_VIRTUAL) return null
      const configPath = path.join(repoRoot, 'web', 'simplicity-covenants.config.json')
      const raw = fs.readFileSync(configPath, 'utf-8')
      const { covenants } = JSON.parse(raw) as { covenants: Array<{ id: string; path: string }> }
      const sources: Record<string, string> = {}
      for (const { id: covenantId, path: filePath } of covenants) {
        const fullPath = path.join(repoRoot, filePath)
        if (!fs.existsSync(fullPath)) {
          throw new Error(`Simplicity covenant file not found: ${fullPath}`)
        }
        sources[covenantId] = fs.readFileSync(fullPath, 'utf-8').trim()
      }
      return `export const sources = ${JSON.stringify(sources)}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    simplicitySourcesPlugin(),
    {
      name: 'lwk-wasm-dev',
      configureServer(server) {
        server.middlewares.use('/lwk_wasm_bg.wasm', (_req, res, next) => {
          const wasmPath = path.resolve(
            server.config.root,
            'node_modules/lwk_web/lwk_wasm_bg.wasm'
          )
          if (!fs.existsSync(wasmPath)) return next()
          res.setHeader('Content-Type', 'application/wasm')
          fs.createReadStream(wasmPath).pipe(res)
        })
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // LWK resolves wasm via new URL('lwk_wasm_bg.wasm', import.meta.url) — keep name stable
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.wasm')
            ? 'assets/lwk_wasm_bg.wasm'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
