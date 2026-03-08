import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadTrackedBorrowerOfferIds,
  rememberTrackedBorrowerOfferId,
} from './borrowerTrackedStorage'

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

describe('borrowerTrackedStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores tracked borrower offer ids per signing key and network', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    rememberTrackedBorrowerOfferId('aa'.repeat(32), 'testnet-liquid', 'offer-a')
    rememberTrackedBorrowerOfferId('aa'.repeat(32), 'localtest-liquid', 'offer-b')
    rememberTrackedBorrowerOfferId('bb'.repeat(32), 'testnet-liquid', 'offer-c')

    expect(loadTrackedBorrowerOfferIds('aa'.repeat(32), 'testnet-liquid')).toEqual(['offer-a'])
    expect(loadTrackedBorrowerOfferIds('aa'.repeat(32), 'localtest-liquid')).toEqual(['offer-b'])
    expect(loadTrackedBorrowerOfferIds('bb'.repeat(32), 'testnet-liquid')).toEqual(['offer-c'])
  })

  it('deduplicates tracked borrower offer ids', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    rememberTrackedBorrowerOfferId('aa'.repeat(32), 'testnet-liquid', 'offer-a')
    rememberTrackedBorrowerOfferId('aa'.repeat(32), 'testnet-liquid', 'offer-a')

    expect(loadTrackedBorrowerOfferIds('aa'.repeat(32), 'testnet-liquid')).toEqual(['offer-a'])
  })
})
