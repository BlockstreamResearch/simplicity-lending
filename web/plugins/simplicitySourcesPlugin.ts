import fs from 'node:fs'
import path from 'node:path'

import type { Plugin, ResolvedConfig } from 'vite'

// Internal Vite virtual module id.
// We dynamically generate this module from raw .simf covenant sources
// so the frontend can import them like a normal ES module.
const SIMPLICITY_SOURCES_VIRTUAL = '\0virtual:simplicity-sources'

interface CovenantConfig {
  covenants: Array<{
    id: string
    path: string
  }>
}

interface SimplicitySourcesPluginOptions {
  configPath: string
}

export function simplicitySourcesPlugin(options: SimplicitySourcesPluginOptions): Plugin {
  let viteConfig: ResolvedConfig

  return {
    name: 'simplicity-sources',

    configResolved(config) {
      viteConfig = config
    },

    resolveId(id) {
      if (id === 'virtual:simplicity-sources') {
        return SIMPLICITY_SOURCES_VIRTUAL
      }

      return null
    },

    load(id) {
      if (id !== SIMPLICITY_SOURCES_VIRTUAL) {
        return null
      }

      const resolvedConfigPath = path.resolve(viteConfig.root, options.configPath)

      if (!fs.existsSync(resolvedConfigPath)) {
        throw new Error(`Simplicity config not found: ${resolvedConfigPath}`)
      }

      const rawConfig = fs.readFileSync(resolvedConfigPath, 'utf-8')

      const config = JSON.parse(rawConfig) as CovenantConfig

      const sources: Record<string, string> = {}

      for (const covenant of config.covenants) {
        const covenantPath = path.resolve(viteConfig.root, covenant.path)

        if (!fs.existsSync(covenantPath)) {
          throw new Error(`Simplicity covenant file not found: ${covenantPath}`)
        }

        sources[covenant.id] = fs.readFileSync(covenantPath, 'utf-8').trim()
      }

      return `
        export const sources = ${JSON.stringify(sources)}
      `
    },
  }
}
