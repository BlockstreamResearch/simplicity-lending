import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getApiBaseUrl,
  getEsploraApiBaseUrl,
  getEsploraExplorerBaseUrl,
  getReownProjectId,
  getRuntimeConfig,
  getWalletAbiNetworkValue,
} from './runtimeConfig'

describe('runtime config', () => {
  const runtimeWindow = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis
  }

  beforeEach(() => {
    runtimeWindow.window = {} as Window & typeof globalThis
  })

  afterEach(() => {
    if (runtimeWindow.window) {
      delete runtimeWindow.window.__SIMPLICITY_LENDING_CONFIG__
    }
    Reflect.deleteProperty(runtimeWindow, 'window')
  })

  it('reads browser runtime config overrides', () => {
    runtimeWindow.window!.__SIMPLICITY_LENDING_CONFIG__ = {
      apiBaseUrl: '/api',
      reownProjectId: 'project-id',
      walletAbiNetwork: 'testnet-liquid',
      esploraBaseUrl: '/esplora',
      esploraExplorerUrl: 'https://blockstream.info/liquidtestnet',
    }

    expect(getRuntimeConfig()).toEqual(runtimeWindow.window!.__SIMPLICITY_LENDING_CONFIG__)
    expect(getApiBaseUrl()).toBe('/api')
    expect(getReownProjectId()).toBe('project-id')
    expect(getWalletAbiNetworkValue()).toBe('testnet-liquid')
    expect(getEsploraApiBaseUrl()).toBe('/esplora')
    expect(getEsploraExplorerBaseUrl()).toBe('https://blockstream.info/liquidtestnet')
  })

  it('falls back to production proxy defaults when no runtime config is set', () => {
    const expectedApiBaseUrl =
      import.meta.env.VITE_API_URL ??
      (import.meta.env.DEV ? 'http://localhost:8000' : '/api')
    const expectedEsploraBaseUrl =
      import.meta.env.VITE_ESPLORA_BASE_URL ??
      (import.meta.env.DEV ? undefined : '/esplora')
    const expectedEsploraExplorerUrl =
      import.meta.env.VITE_ESPLORA_EXPLORER_URL ?? expectedEsploraBaseUrl
    const expectedReownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID ?? ''
    const expectedWalletAbiNetwork = import.meta.env.VITE_WALLET_ABI_NETWORK

    expect(getApiBaseUrl()).toBe(expectedApiBaseUrl)
    expect(getEsploraApiBaseUrl()).toBe(expectedEsploraBaseUrl)
    expect(getEsploraExplorerBaseUrl()).toBe(expectedEsploraExplorerUrl)
    expect(getReownProjectId()).toBe(expectedReownProjectId)
    expect(getWalletAbiNetworkValue()).toBe(expectedWalletAbiNetwork)
  })
})
