/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_ESPLORA_BASE_URL?: string
  readonly VITE_NETWORK?: 'liquid' | 'liquidtestnet' | 'regtest'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
