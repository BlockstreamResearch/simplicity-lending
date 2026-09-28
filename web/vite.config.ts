import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { checker } from 'vite-plugin-checker'

import { simplicitySourcesPlugin } from './plugins/simplicitySourcesPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))

// Link previews (Telegram, X, Facebook) ignore relative og:image URLs.
function publicUrlPlugin(publicUrl = ''): Plugin {
  return {
    name: 'public-url',
    transformIndexHtml: html => html.replaceAll('%PUBLIC_URL%', publicUrl.replace(/\/$/, '')),
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const configEnv = loadEnv(mode, root, '')
  const apiProxyTarget = configEnv.API_PROXY_TARGET
  const useLocalApiProxy = command === 'serve' && mode === 'development' && apiProxyTarget

  return {
    plugins: [
      publicUrlPlugin(configEnv.VITE_PUBLIC_URL),
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
