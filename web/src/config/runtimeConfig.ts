import type { WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'

export interface SimplicityLendingRuntimeConfig {
  apiBaseUrl?: string
  reownProjectId?: string
  walletAbiNetwork?: WalletAbiNetwork
  esploraBaseUrl?: string
  esploraExplorerUrl?: string
}

declare global {
  interface Window {
    __SIMPLICITY_LENDING_CONFIG__?: SimplicityLendingRuntimeConfig
  }
}

const DEFAULT_DEV_API_BASE_URL = 'http://localhost:8000'
const DEFAULT_PRODUCTION_API_BASE_URL = '/api'
const DEFAULT_PRODUCTION_ESPLORA_BASE_URL = '/esplora'

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function getWindowRuntimeConfig(): SimplicityLendingRuntimeConfig {
  if (typeof window === 'undefined') {
    return {}
  }

  return window.__SIMPLICITY_LENDING_CONFIG__ ?? {}
}

export function getRuntimeConfig(): Readonly<SimplicityLendingRuntimeConfig> {
  return getWindowRuntimeConfig()
}

export function getApiBaseUrl(): string {
  return (
    normalizeOptionalString(getRuntimeConfig().apiBaseUrl) ??
    normalizeOptionalString(import.meta.env.VITE_API_URL) ??
    (import.meta.env.DEV ? DEFAULT_DEV_API_BASE_URL : DEFAULT_PRODUCTION_API_BASE_URL)
  )
}

export function getReownProjectId(): string {
  return (
    normalizeOptionalString(getRuntimeConfig().reownProjectId) ??
    normalizeOptionalString(import.meta.env.VITE_REOWN_PROJECT_ID) ??
    ''
  )
}

export function getWalletAbiNetworkValue(): string | undefined {
  return (
    normalizeOptionalString(getRuntimeConfig().walletAbiNetwork) ??
    normalizeOptionalString(import.meta.env.VITE_WALLET_ABI_NETWORK)
  )
}

export function getEsploraApiBaseUrl(): string | undefined {
  return (
    normalizeOptionalString(getRuntimeConfig().esploraBaseUrl) ??
    normalizeOptionalString(import.meta.env.VITE_ESPLORA_BASE_URL) ??
    (import.meta.env.DEV ? undefined : DEFAULT_PRODUCTION_ESPLORA_BASE_URL)
  )
}

export function getEsploraExplorerBaseUrl(): string | undefined {
  return (
    normalizeOptionalString(getRuntimeConfig().esploraExplorerUrl) ??
    normalizeOptionalString(import.meta.env.VITE_ESPLORA_EXPLORER_URL) ??
    getEsploraApiBaseUrl()
  )
}
