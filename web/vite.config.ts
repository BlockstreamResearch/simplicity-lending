import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { checker } from 'vite-plugin-checker'

import { simplicitySourcesPlugin } from './plugins/simplicitySourcesPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const configEnv = loadEnv(mode, root, '')
  const apiProxyTarget = configEnv.API_PROXY_TARGET
  const useLocalApiProxy = command === 'serve' && mode === 'development' && apiProxyTarget

  return {
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
    server: useLocalApiProxy
      ? {
          proxy: {
            '/api': {
              target: apiProxyTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  }
})
