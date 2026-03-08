import { describe, expect, it } from 'vitest'
import { mergeBorrowerOffers, summarizeBorrowerOffers } from './borrowerOffers'
import type { OfferWithParticipants } from '../types/offers'

function makeOffer(
  id: string,
  status: OfferWithParticipants['status'],
  createdAtHeight: bigint,
  borrowerScript: string
): OfferWithParticipants {
  return {
    id,
    status,
    collateral_asset: '11'.repeat(32),
    principal_asset: '22'.repeat(32),
    collateral_amount: status === 'active' ? 25_000n : 10_000n,
    principal_amount: 10_000n,
    interest_rate: 500,
    loan_expiration_time: 123_456,
    created_at_height: createdAtHeight,
    created_at_txid: '33'.repeat(32),
    participants: [
      {
        offer_id: id,
        participant_type: 'borrower',
        script_pubkey: borrowerScript,
      },
    ],
  }
}

describe('mergeBorrowerOffers', () => {
  it('keeps active offers discovered only through tracked ids', () => {
    const trackedActiveOffer = makeOffer(
      'borrower-active',
      'active',
      20n,
      '5120' + '44'.repeat(32)
    )
    const merged = mergeBorrowerOffers({
      detailedOffers: [trackedActiveOffer],
      knownScripts: ['5120' + '55'.repeat(32)],
      trackedOfferIds: ['borrower-active'],
      pendingBorrowerPubkeyOfferIds: [],
    })

    expect(merged.map((offer) => offer.id)).toEqual(['borrower-active'])
    expect(merged[0]?.status).toBe('active')
  })

  it('deduplicates script, tracked, and pubkey-discovered offers and sorts by height', () => {
    const borrowerScript = '5120' + '66'.repeat(32)
    const scriptMatchedOffer = makeOffer('script-match', 'active', 10n, borrowerScript)
    const pendingPubkeyOffer = makeOffer('pending-match', 'pending', 30n, '5120' + '77'.repeat(32))

    const merged = mergeBorrowerOffers({
      detailedOffers: [scriptMatchedOffer, pendingPubkeyOffer],
      knownScripts: [borrowerScript],
      trackedOfferIds: ['script-match'],
      pendingBorrowerPubkeyOfferIds: ['pending-match'],
    })

    expect(merged.map((offer) => offer.id)).toEqual(['pending-match', 'script-match'])
  })
})

describe('summarizeBorrowerOffers', () => {
  it('counts active and pending offers from the merged borrower set', () => {
    const offers = mergeBorrowerOffers({
      detailedOffers: [
        makeOffer('tracked-active', 'active', 40n, '5120' + '88'.repeat(32)),
        makeOffer('pending-match', 'pending', 35n, '5120' + '99'.repeat(32)),
      ],
      knownScripts: ['5120' + 'aa'.repeat(32)],
      trackedOfferIds: ['tracked-active'],
      pendingBorrowerPubkeyOfferIds: ['pending-match'],
    })

    expect(summarizeBorrowerOffers(offers)).toEqual({
      lockedLbtc: 25_000n,
      activeDeals: 1,
      pendingDeals: 1,
    })
  })
})
