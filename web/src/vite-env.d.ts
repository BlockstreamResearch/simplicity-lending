/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_REOWN_PROJECT_ID?: string
  readonly VITE_WALLET_ABI_NETWORK?: string
  readonly VITE_ESPLORA_BASE_URL?: string
  readonly VITE_ESPLORA_EXPLORER_URL?: string
}

declare module 'virtual:simplicity-sources' {
  export const sources: Record<string, string>
}
