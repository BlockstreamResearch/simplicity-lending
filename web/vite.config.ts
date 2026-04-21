import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasmPlugin from 'vite-plugin-wasm'
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
  // Vitest extension (see vitest.config reference or run vitest for tests)
  // @ts-expect-error - Vite's UserConfigExport doesn't include Vitest's 'test'
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
  plugins: [
    (wasmPlugin as unknown as () => unknown)() as never,
    react(),
    simplicitySourcesPlugin(),
  ],
  build: {
    target: 'esnext',
  },
})
