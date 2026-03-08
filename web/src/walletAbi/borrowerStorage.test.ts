import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearBorrowerFlowState,
  loadBorrowerFlowState,
  saveBorrowerFlowState,
} from './borrowerStorage'

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

describe('borrowerStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores borrower flow state per signing x-only pubkey', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    saveBorrowerFlowState('aa'.repeat(32), {
      prepareTxid: 'prepare-a',
      issuanceTxid: 'issue-a',
    })
    saveBorrowerFlowState('bb'.repeat(32), {
      prepareTxid: 'prepare-b',
      issuanceTxid: null,
    })

    expect(loadBorrowerFlowState('aa'.repeat(32))).toEqual({
      prepareTxid: 'prepare-a',
      issuanceTxid: 'issue-a',
    })
    expect(loadBorrowerFlowState('bb'.repeat(32))).toEqual({
      prepareTxid: 'prepare-b',
      issuanceTxid: null,
    })
  })

  it('clears only the selected borrower flow state', () => {
    vi.stubGlobal('localStorage', createLocalStorageMock())

    saveBorrowerFlowState('aa'.repeat(32), {
      prepareTxid: 'prepare-a',
      issuanceTxid: 'issue-a',
    })
    saveBorrowerFlowState('bb'.repeat(32), {
      prepareTxid: 'prepare-b',
      issuanceTxid: 'issue-b',
    })

    clearBorrowerFlowState('aa'.repeat(32))

    expect(loadBorrowerFlowState('aa'.repeat(32))).toEqual({
      prepareTxid: null,
      issuanceTxid: null,
    })
    expect(loadBorrowerFlowState('bb'.repeat(32))).toEqual({
      prepareTxid: 'prepare-b',
      issuanceTxid: 'issue-b',
    })
  })
})
