import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getApiBaseUrl,
  getEsploraApiBaseUrl,
  getEsploraExplorerBaseUrl,
  getRuntimeConfig,
  getWalletAbiTransportNetwork,
  getWalletConnectProjectId,
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
    expect(getWalletConnectProjectId()).toBe('project-id')
    expect(getWalletAbiTransportNetwork()).toBe('testnet-liquid')
    expect(getEsploraApiBaseUrl()).toBe('/esplora')
    expect(getEsploraExplorerBaseUrl()).toBe('https://blockstream.info/liquidtestnet')
  })

  it('falls back to env and default values when runtime config is missing', () => {
    const expectedApiBaseUrl =
      import.meta.env.VITE_API_URL ??
      (import.meta.env.DEV ? 'http://localhost:8000' : '/api')
    const expectedEsploraBaseUrl =
      import.meta.env.VITE_ESPLORA_BASE_URL ??
      (import.meta.env.DEV
        ? 'https://blockstream.info/liquidtestnet/api'
        : '/esplora')
    const expectedWalletConnectProjectId =
      import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
      import.meta.env.VITE_REOWN_PROJECT_ID ??
      ''
    const expectedWalletAbiNetwork = (() => {
      switch (import.meta.env.VITE_WALLET_ABI_NETWORK) {
        case 'liquid':
        case 'testnet-liquid':
        case 'localtest-liquid':
          return import.meta.env.VITE_WALLET_ABI_NETWORK
        case 'liquid-testnet':
          return 'testnet-liquid'
        case 'liquid-regtest':
          return 'localtest-liquid'
        default:
          return 'testnet-liquid'
      }
    })()

    expect(getApiBaseUrl()).toBe(expectedApiBaseUrl)
    expect(getEsploraApiBaseUrl()).toBe(expectedEsploraBaseUrl)
    expect(getWalletConnectProjectId()).toBe(expectedWalletConnectProjectId)
    expect(getWalletAbiTransportNetwork()).toBe(expectedWalletAbiNetwork)
  })
})
