import { describe, expect, it } from 'vitest'

import type { OfferDetails } from '@/api/indexer/schemas'

import { protocolActionRequest } from './actionRequest'
import manifest from './lending_v3.manifest.json'
import { offerCovenants, offerDeploymentInput } from './offerDeployment'

/**
 * What an action on an existing offer sends, and what it deliberately does not.
 *
 * Accepting and cancelling both read the deployment the offer created. The values it was
 * recorded with are published; the covenant script hashes are compiler output and are the
 * wallet's to work out. A hash sent from here would be this dapp's own copy of what the document
 * derives, and nothing anywhere would compare the two.
 */

const TXID = 'e0154712bfc8e27adc9c87575bbf95fcb31fc5fb6554b833095bc34cb6e6484e'

const OFFER = {
  borrowerNftAssetId: '99849d670e19648c7e516634e081a4478f6ab1eb1b01690c5c4c4a0a51bb0307',
  collateralAmount: 30_000n,
  collateralAssetId: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
  covenants: [
    { txid: TXID, utxo_type: 'lending_collateral', vout: 5 },
    { txid: TXID, utxo_type: 'lender_nft_script_auth', vout: 3 },
  ],
  factoryAssetId: '9fa8b2253ff1c111687ce70a0909ae36ee7cb88bdfa2d1adb68e1dbce29d363a',
  lenderNftAssetId: '70a52f11d838cbda328c0aee12e9a0bb6db471cebc1acdab9ae0a1f6dbcf1f8e',
  loanExpirationHeight: 2_580_091,
  principalAmount: 2_000n,
  principalAssetId: '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
  principalInterestRateBps: 500,
  protocolFeeKeeperAssetId: '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
}

/** One offer as the indexer reports it, with only the fields the covenant reading uses. */
function indexed(input: {
  participants?: OfferDetails['participants']
  status: OfferDetails['status']
  utxos?: OfferDetails['utxos']
}): OfferDetails {
  return {
    participants: [],
    utxos: [],
    ...input,
  } as unknown as OfferDetails
}

const UNSPENT = { created_at_height: 1, offer_id: '3', spent_at_height: null, spent_txid: null }
const PARTICIPANT = { ...UNSPENT, script_pubkey: '0014' + 'ab'.repeat(20) }

const SOURCES = {
  'asset_auth.simf': 'asset_auth source',
  'asset_auth_vault.simf': 'asset_auth_vault source',
  'issuance_factory.simf': 'issuance_factory source',
  'lending.simf': 'lending source',
  'script_auth.simf': 'script_auth source',
}

describe('the covenants an offer still holds', () => {
  it('names a pending offer by the two covenants its next action spends', () => {
    const covenants = offerCovenants(
      indexed({
        participants: [
          { ...PARTICIPANT, participant_type: 'borrower', txid: TXID, vout: 2 },
          { ...PARTICIPANT, participant_type: 'lender', txid: TXID, vout: 3 },
        ],
        status: 'pending',
        utxos: [{ ...UNSPENT, txid: TXID, utxo_type: 'pending_offer', vout: 5 }],
      }),
    )

    expect(covenants).toEqual([
      { txid: TXID, utxo_type: 'lending_collateral', vout: 5 },
      { txid: TXID, utxo_type: 'lender_nft_script_auth', vout: 3 },
    ])
  })

  it('drops the lender NFT once the offer is active, because a wallet holds it by then', () => {
    const covenants = offerCovenants(
      indexed({
        participants: [{ ...PARTICIPANT, participant_type: 'lender', txid: TXID, vout: 2 }],
        status: 'active',
        utxos: [
          { ...UNSPENT, txid: TXID, utxo_type: 'active_offer', vout: 0 },
          { ...UNSPENT, txid: TXID, utxo_type: 'borrower_principal', vout: 1 },
        ],
      }),
    )

    expect(covenants).toEqual([
      { txid: TXID, utxo_type: 'lending_collateral_active', vout: 0 },
      { txid: TXID, utxo_type: 'principal_asset_auth', vout: 1 },
    ])
  })

  it('names what a full repayment left for the lender by what the document calls it', () => {
    const covenants = offerCovenants(
      indexed({
        status: 'repaid',
        utxos: [{ ...UNSPENT, txid: TXID, utxo_type: 'repayment', vout: 1 }],
      }),
    )

    expect(covenants).toEqual([{ txid: TXID, utxo_type: 'lender_vault_finalized', vout: 1 }])
  })

  it('leaves out an output something already spent', () => {
    const covenants = offerCovenants(
      indexed({
        status: 'active',
        utxos: [
          {
            ...UNSPENT,
            spent_txid: 'ab'.repeat(32),
            txid: TXID,
            utxo_type: 'active_offer',
            vout: 0,
          },
          { ...UNSPENT, txid: TXID, utxo_type: 'borrower_principal', vout: 1 },
        ],
      }),
    )

    expect(covenants).toEqual([{ txid: TXID, utxo_type: 'principal_asset_auth', vout: 1 }])
  })
})

describe('an action on an existing offer', () => {
  it('carries the deployment as it was recorded, and no value a compiler makes', () => {
    const { instance } = offerDeploymentInput(OFFER)

    expect(instance).toEqual({
      BORROWER_NFT_ASSET_ID: OFFER.borrowerNftAssetId,
      COLLATERAL_AMOUNT: '30000',
      COLLATERAL_ASSET_ID: OFFER.collateralAssetId,
      FACTORY_ASSET_ID: OFFER.factoryAssetId,
      LENDER_NFT_ASSET_ID: OFFER.lenderNftAssetId,
      LOAN_EXPIRATION_TIME: '2580091',
      PRINCIPAL_AMOUNT: '2000',
      PRINCIPAL_ASSET_ID: OFFER.principalAssetId,
      PRINCIPAL_INTEREST_RATE: '500',
      PROTOCOL_FEE_KEEPER_ASSET_ID: OFFER.protocolFeeKeeperAssetId,
    })
  })

  it('locates whatever the offer still holds, under the types the document names', () => {
    const { state } = offerDeploymentInput(OFFER)

    expect(state.utxos).toBe(OFFER.covenants)
  })

  it.each(['AcceptOffer', 'CancelOffer'])(
    'reaches the wallet as a deployment file for %s, beside no parameters of its own',
    action => {
      const { instance, state } = offerDeploymentInput(OFFER)
      const request = protocolActionRequest(
        { manifest, sources: SOURCES },
        { action, instance, state },
      )

      expect(request.instance).toEqual({ instance: { fields: instance } })
      expect(request.params).toEqual({})
      expect(request.state).toBe(state)
    },
  )
})
