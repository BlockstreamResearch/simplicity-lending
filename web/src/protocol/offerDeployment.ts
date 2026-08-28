/**
 * What an action on an existing offer asks the wallet for, as plain values.
 *
 * Every action after creation declares no parameters at all: what each one needs is a field of
 * the deployment the offer created. Half of that deployment is ordinary values the indexer
 * publishes — both assets, both amounts, the rate, the expiration, both NFT ids — and half is
 * covenant script hashes, which are compiler output and are worked out by the wallet from the
 * first half.
 *
 * One deployment serves all of them, because they read the same offer. What differs between
 * accepting and cancelling is which branch of the covenant runs and who is paid, and both of
 * those are the document's to state rather than this dapp's to send.
 *
 * Separated from the hooks that gather them so the request can be checked against the wallet's
 * own review without a browser.
 */

import type { OfferDetails } from '@/api/indexer/schemas'
import type { ProtocolState, ProtocolStateUtxo } from '@/protocol/actionRequest'

/** The deployment as the indexer reports it, before the wallet completes it. */
export interface OfferDeployment {
  borrowerNftAssetId: string
  collateralAmount: bigint
  collateralAssetId: string
  /** The deployment's live covenant outputs, under the utxo types the document names. */
  covenants: ProtocolStateUtxo[]
  factoryAssetId: string
  lenderNftAssetId: string
  loanExpirationHeight: number
  principalAmount: bigint
  principalAssetId: string
  principalInterestRateBps: number
  protocolFeeKeeperAssetId: string
}

export interface OfferDeploymentInput {
  instance: Record<string, string>
  state: ProtocolState
}

/**
 * What the indexer calls each covenant output, against what the deployed document calls it.
 *
 * The indexer names an output for the moment it was created in; the document names it for what
 * it is. A type the indexer reports and this does not map is a record of something spent rather
 * than a covenant standing on chain, and has nothing for an action to spend.
 */
const COVENANT_UTXO_TYPES: Record<string, string> = {
  active_offer: 'lending_collateral_active',
  borrower_principal: 'principal_asset_auth',
  pending_offer: 'lending_collateral',
  // What a full repayment leaves behind: the lender's share, waiting in the vault the document
  // calls finalized. The indexer names it for the moment that created it rather than for what
  // it is, which is the whole reason this mapping exists.
  repayment: 'lender_vault_finalized',
}

/** The utxo type the document gives the lender NFT while it is still held by a covenant. */
const LENDER_NFT_COVENANT = 'lender_nft_script_auth'

/**
 * The deployment's live covenant outputs, as the indexer reports them.
 *
 * Only what is still unspent, because the state file is what an action locates its inputs in
 * and a spent output locates nothing. The lender NFT is here only while the offer is pending:
 * accepting hands it back to a wallet, and a wallet output under a covenant's utxo type would
 * send the next action looking for a covenant at an ordinary address.
 */
export function offerCovenants(offer: OfferDetails): ProtocolStateUtxo[] {
  const utxos: ProtocolStateUtxo[] = []

  for (const utxo of offer.utxos) {
    const utxoType = COVENANT_UTXO_TYPES[utxo.utxo_type]

    if (utxoType === undefined || utxo.spent_txid) continue

    utxos.push({ txid: utxo.txid, utxo_type: utxoType, vout: utxo.vout })
  }

  if (offer.status === 'pending') {
    const lender = offer.participants.find(
      participant => participant.participant_type === 'lender' && !participant.spent_txid,
    )

    if (lender) {
      utxos.push({ txid: lender.txid, utxo_type: LENDER_NFT_COVENANT, vout: lender.vout })
    }
  }

  return utxos
}

/**
 * Builds the deployment file and the covenant lookup for one offer.
 *
 * Only the fields the offer was recorded with. The covenant hashes are left out deliberately:
 * a value this dapp sent would be its own copy of what the document derives, and nothing would
 * compare the two — the wallet computes them from the document's own description instead.
 */
export function offerDeploymentInput(offer: OfferDeployment): OfferDeploymentInput {
  return {
    instance: {
      BORROWER_NFT_ASSET_ID: offer.borrowerNftAssetId,
      COLLATERAL_AMOUNT: String(offer.collateralAmount),
      COLLATERAL_ASSET_ID: offer.collateralAssetId,
      FACTORY_ASSET_ID: offer.factoryAssetId,
      LENDER_NFT_ASSET_ID: offer.lenderNftAssetId,
      LOAN_EXPIRATION_TIME: String(offer.loanExpirationHeight),
      PRINCIPAL_AMOUNT: String(offer.principalAmount),
      PRINCIPAL_ASSET_ID: offer.principalAssetId,
      PRINCIPAL_INTEREST_RATE: String(offer.principalInterestRateBps),
      PROTOCOL_FEE_KEEPER_ASSET_ID: offer.protocolFeeKeeperAssetId,
    },
    state: { utxos: offer.covenants },
  }
}
