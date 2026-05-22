/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_ESPLORA_BASE_URL?: string
  readonly VITE_NETWORK?: 'liquid' | 'liquidtestnet' | 'regtest'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare module 'virtual:simplicity-sources' {
  export interface SimplicitySources {
    lending: string
    asset_auth: string
    script_auth: string
  }

  export const sources: SimplicitySources
}
