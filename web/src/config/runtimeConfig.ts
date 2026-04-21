export type WalletAbiTransportNetwork = 'liquid' | 'testnet-liquid' | 'localtest-liquid'

export interface SimplicityLendingRuntimeConfig {
  apiBaseUrl?: string
  reownProjectId?: string
  walletAbiNetwork?: WalletAbiTransportNetwork | 'liquid-testnet' | 'liquid-regtest'
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
const DEFAULT_DEV_ESPLORA_BASE_URL = 'https://blockstream.info/liquidtestnet/api'
const DEFAULT_PRODUCTION_ESPLORA_BASE_URL = '/esplora'
const DEFAULT_DEV_ESPLORA_EXPLORER_URL = 'https://blockstream.info/liquidtestnet'

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

export function getWalletConnectProjectId(): string {
  return (
    normalizeOptionalString(getRuntimeConfig().reownProjectId) ??
    normalizeOptionalString(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID) ??
    normalizeOptionalString(import.meta.env.VITE_REOWN_PROJECT_ID) ??
    ''
  )
}

export function getWalletAbiTransportNetwork(): WalletAbiTransportNetwork {
  const configured =
    normalizeOptionalString(getRuntimeConfig().walletAbiNetwork) ??
    normalizeOptionalString(import.meta.env.VITE_WALLET_ABI_NETWORK) ??
    'testnet-liquid'

  switch (configured) {
    case 'liquid':
    case 'testnet-liquid':
    case 'localtest-liquid':
      return configured
    case 'liquid-testnet':
      return 'testnet-liquid'
    case 'liquid-regtest':
      return 'localtest-liquid'
    default:
      return 'testnet-liquid'
  }
}

export function getEsploraApiBaseUrl(): string {
  return (
    normalizeOptionalString(getRuntimeConfig().esploraBaseUrl) ??
    normalizeOptionalString(import.meta.env.VITE_ESPLORA_BASE_URL) ??
    (import.meta.env.DEV ? DEFAULT_DEV_ESPLORA_BASE_URL : DEFAULT_PRODUCTION_ESPLORA_BASE_URL)
  )
}

export function getEsploraExplorerBaseUrl(): string {
  const configured =
    normalizeOptionalString(getRuntimeConfig().esploraExplorerUrl) ??
    normalizeOptionalString(import.meta.env.VITE_ESPLORA_EXPLORER_URL)

  if (configured) {
    return configured
  }

  const apiBaseUrl = getEsploraApiBaseUrl()
  if (apiBaseUrl === DEFAULT_DEV_ESPLORA_BASE_URL) {
    return DEFAULT_DEV_ESPLORA_EXPLORER_URL
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(apiBaseUrl)) {
    return apiBaseUrl.replace(/\/api$/, '')
  }

  return DEFAULT_DEV_ESPLORA_EXPLORER_URL
}
