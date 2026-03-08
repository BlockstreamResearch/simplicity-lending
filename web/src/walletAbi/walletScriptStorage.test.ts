import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadKnownWalletScripts, rememberWalletScript } from './walletScriptStorage'

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
}

describe('walletScriptStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores wallet scripts per signing key and network', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    rememberWalletScript('aa'.repeat(32), 'testnet-liquid', '0014' + '11'.repeat(20))
    rememberWalletScript('aa'.repeat(32), 'localtest-liquid', '0014' + '22'.repeat(20))
    rememberWalletScript('bb'.repeat(32), 'testnet-liquid', '0014' + '33'.repeat(20))

    expect(loadKnownWalletScripts('aa'.repeat(32), 'testnet-liquid')).toEqual([
      '0014' + '11'.repeat(20),
    ])
    expect(loadKnownWalletScripts('aa'.repeat(32), 'localtest-liquid')).toEqual([
      '0014' + '22'.repeat(20),
    ])
    expect(loadKnownWalletScripts('bb'.repeat(32), 'testnet-liquid')).toEqual([
      '0014' + '33'.repeat(20),
    ])
  })

  it('deduplicates remembered wallet scripts', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    rememberWalletScript('aa'.repeat(32), 'testnet-liquid', '0014' + '11'.repeat(20))
    rememberWalletScript('aa'.repeat(32), 'testnet-liquid', '0014' + '11'.repeat(20))

    expect(loadKnownWalletScripts('aa'.repeat(32), 'testnet-liquid')).toEqual([
      '0014' + '11'.repeat(20),
    ])
  })
})
