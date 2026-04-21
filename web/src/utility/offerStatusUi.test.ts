import { describe, expect, it } from 'vitest'
import { getOfferStatusUi } from './offerStatusUi'

describe('getOfferStatusUi', () => {
  it('labels expired pending offers as expired', () => {
    expect(
      getOfferStatusUi({
        status: 'pending',
        loanExpirationTime: 100,
        currentBlockHeight: 100,
      }).label
    ).toBe('Expired')
  })

  it('keeps pending offers pending before expiration', () => {
    expect(
      getOfferStatusUi({
        status: 'pending',
        loanExpirationTime: 101,
        currentBlockHeight: 100,
      }).label
    ).toBe('Pending')
  })
})
