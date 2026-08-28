/**
 * What creating a lending offer asks the wallet for, as plain values.
 *
 * Separated from the hook that gathers them so the request can be checked against the wallet's
 * own review without a browser: the numbers a person chose, the deployment's asset ids, the
 * factory the indexer reports and the chain's tip go in, and the document's own parameter names
 * come out.
 */

import type { ProtocolState } from '@/protocol/actionRequest'

/** What a lender chose. Everything else about the offer is stated by the deployment. */
export interface ChosenOffer {
  collateralAmount: bigint
  /** How long the loan runs, in blocks, counted from the tip at the moment it is created. */
  loanDurationBlocks: number
  principalAmount: bigint
  principalInterestRateBps: number
}

/** The factory this account borrows through, as the indexer reports it. */
export interface OfferFactory {
  factoryAssetId: string
  /** `txid:vout` of the covenant output the offer is minted from. */
  issuanceFactoryOutpoint: string
}

/** Which assets this deployment lends and takes as collateral. */
export interface OfferAssets {
  collateralAssetId: string
  principalAssetId: string
  protocolFeeKeeperAssetId: string
}

/** The utxo type the deployed document gives the factory covenant an offer is minted from. */
const FACTORY_COVENANT = 'issuance_factory'

export interface OfferRequestInput {
  params: Record<string, string>
  state: ProtocolState
}

/**
 * Builds the parameters and the covenant lookup for one offer.
 *
 * `LOAN_EXPIRATION_TIME` is a liquidation height rather than a term, so the blocks a person
 * chose are added to the tip the offer is made at. Every parameter the document states a
 * default for is left out, because the deployment answers for it.
 */
export function offerRequestInput(input: {
  assets: OfferAssets
  chosen: ChosenOffer
  factory: OfferFactory
  tipHeight: number
}): OfferRequestInput {
  const [txid, vout] = input.factory.issuanceFactoryOutpoint.split(':')

  return {
    params: {
      COLLATERAL_AMOUNT: String(input.chosen.collateralAmount),
      COLLATERAL_ASSET_ID: input.assets.collateralAssetId,
      FACTORY_ASSET_ID: input.factory.factoryAssetId,
      LOAN_EXPIRATION_TIME: String(input.tipHeight + input.chosen.loanDurationBlocks),
      PRINCIPAL_AMOUNT: String(input.chosen.principalAmount),
      PRINCIPAL_ASSET_ID: input.assets.principalAssetId,
      PRINCIPAL_INTEREST_RATE: String(input.chosen.principalInterestRateBps),
      PROTOCOL_FEE_KEEPER_ASSET_ID: input.assets.protocolFeeKeeperAssetId,
    },
    state: { utxos: [{ txid: txid ?? '', utxo_type: FACTORY_COVENANT, vout: Number(vout) }] },
  }
}
