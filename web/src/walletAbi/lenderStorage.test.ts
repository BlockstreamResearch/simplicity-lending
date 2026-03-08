import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTrackedLenderOfferIds, rememberTrackedLenderOfferId } from './lenderStorage'

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

describe('lenderStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores tracked lender offer ids per signing key and network', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    rememberTrackedLenderOfferId('aa'.repeat(32), 'testnet-liquid', 'offer-a')
    rememberTrackedLenderOfferId('aa'.repeat(32), 'localtest-liquid', 'offer-b')
    rememberTrackedLenderOfferId('bb'.repeat(32), 'testnet-liquid', 'offer-c')

    expect(loadTrackedLenderOfferIds('aa'.repeat(32), 'testnet-liquid')).toEqual(['offer-a'])
    expect(loadTrackedLenderOfferIds('aa'.repeat(32), 'localtest-liquid')).toEqual(['offer-b'])
    expect(loadTrackedLenderOfferIds('bb'.repeat(32), 'testnet-liquid')).toEqual(['offer-c'])
  })

  it('deduplicates tracked lender offer ids', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    rememberTrackedLenderOfferId('aa'.repeat(32), 'testnet-liquid', 'offer-a')
    rememberTrackedLenderOfferId('aa'.repeat(32), 'testnet-liquid', 'offer-a')

    expect(loadTrackedLenderOfferIds('aa'.repeat(32), 'testnet-liquid')).toEqual(['offer-a'])
  })
})
