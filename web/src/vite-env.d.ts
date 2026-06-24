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
    asset_auth_vault: string
    script_auth: string
    issuance_factory: string
  }

  export const sources: SimplicitySources
}

declare module '@fontsource-variable/inter'
