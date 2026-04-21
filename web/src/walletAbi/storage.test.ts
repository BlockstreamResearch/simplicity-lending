import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadLenderFlowState, trackLenderOfferId, trackLenderScriptPubkey } from './storage'

describe('lender flow storage', () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let entries: Map<string, string>

  beforeEach(() => {
    entries = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
      },
    })
  })

  afterEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
      return
    }

    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('remembers lender offer ids and receive scripts by wallet identity', () => {
    trackLenderOfferId('Wallet Identity', 'Offer-A')
    trackLenderOfferId('Wallet Identity', 'offer-a')
    trackLenderScriptPubkey('Wallet Identity', '0014ABCD')

    expect(loadLenderFlowState('wallet identity')).toEqual({
      offerIds: ['offer-a'],
      scriptPubkeys: ['0014abcd'],
    })
  })
})
