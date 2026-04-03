/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAUCET_URL?: string
}

declare module 'virtual:simplicity-sources' {
  export const sources: Record<string, string>
}
