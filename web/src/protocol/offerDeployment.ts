/**
 * What an action on an existing offer asks the wallet for, as plain values.
 *
 * Every action after creation declares no parameters at all: what each one needs is a field of
 * the deployment the offer created. Half of that deployment is ordinary values the indexer
 * publishes — both assets, both amounts, the rate, the expiration, both NFT ids — and half is
 * covenant script hashes, which are compiler output derived here from the first half.
 *
 * One deployment serves all of them, because they read the same offer. What differs between
 * accepting and cancelling is which branch of the covenant runs and who is paid, and both of
 * those are the document's to state rather than this dapp's to send.
 *
 * Separated from the hooks that gather them so the request can be checked against the wallet's
 * own review without a browser.
 */

import { AssetId } from '@lilbonekit/lwk-web'

import type { OfferDetails } from '@/api/indexer/schemas'
import type { ProtocolState, ProtocolStateUtxo } from '@/protocol/actionRequest'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { bytes32ToHex } from '@/utils/hex'
import { toBytes32, toUint16, toUint32, toUint64 } from '@/utils/uint'

/** The deployment as the indexer reports it, before its covenant hashes are derived. */
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
 * The all-zero hash the finalized vaults are compiled with. The document declares it as a field
 * with a default, but the wallet fills defaults only for an action's own parameters, and the
 * actions that spend a finalized vault declare none by this name.
 */
const ZERO_HASH = '0'.repeat(64)

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
 * The deployment file carries every compile-time field of the offer: the values it was recorded
 * with, and the covenant script hashes compiled from them. The document's constructor computes
 * the hashes once and every later action reads them from the deployment, so they are derived
 * here, through the same derivation the offer was created with. A wrong hash is not trusted on
 * its word: the wallet compiles each covenant from these fields and refuses the action when the
 * result does not match the script that locks the output on chain.
 *
 * Deriving the hashes loads the chain library's compiler, which must already be initialized.
 */
export function offerDeploymentInput(offer: OfferDeployment): OfferDeploymentInput {
  const offerParameters = {
    collateralAmount: toUint64(offer.collateralAmount, 'collateralAmount'),
    principalAmount: toUint64(offer.principalAmount, 'principalAmount'),
    principalInterestRate: toUint16(offer.principalInterestRateBps, 'principalInterestRate'),
    loanExpirationTime: toUint32(offer.loanExpirationHeight, 'loanExpirationTime'),
  }
  const derivedLendingParams = buildDerivedLendingOfferProgramParams({
    collateralAssetId: assetIdBytes(offer.collateralAssetId, 'collateralAssetId'),
    principalAssetId: assetIdBytes(offer.principalAssetId, 'principalAssetId'),
    borrowerNftAssetId: assetIdBytes(offer.borrowerNftAssetId, 'borrowerNftAssetId'),
    lenderNftAssetId: assetIdBytes(offer.lenderNftAssetId, 'lenderNftAssetId'),
    protocolFeeKeeperAssetId: assetIdBytes(
      offer.protocolFeeKeeperAssetId,
      'protocolFeeKeeperAssetId',
    ),
    offerParameters,
  })
  // The pending covenant, whatever state the offer is in now: the lender NFT's script-auth
  // covenant was keyed to it at creation and the field never changes.
  const pendingLendingSpendInfo = buildLendingOfferSpendInfo(
    loadLendingProgram(derivedLendingParams),
    offerParameters,
  )

  return {
    instance: {
      BORROWER_NFT_ASSET_ID: offer.borrowerNftAssetId,
      COLLATERAL_AMOUNT: String(offer.collateralAmount),
      COLLATERAL_ASSET_ID: offer.collateralAssetId,
      // The debt the lending covenant's storage leaf commits to, from the same computation that
      // builds that leaf. No action changes it after creation.
      CURRENT_DEBT: String(getTotalAmountToRepay(offerParameters)),
      FACTORY_ASSET_ID: offer.factoryAssetId,
      FINALIZED_LENDER_VAULT_COV_HASH: bytes32ToHex(
        derivedLendingParams.finalizedLenderVaultCovHash,
      ),
      FINALIZED_PROTOCOL_FEE_VAULT_COV_HASH: bytes32ToHex(
        derivedLendingParams.finalizedProtocolFeeVaultCovHash,
      ),
      LENDER_NFT_ASSET_ID: offer.lenderNftAssetId,
      LENDER_VAULT_COV_HASH: bytes32ToHex(derivedLendingParams.lenderVaultCovHash),
      LENDING_COV_SCRIPT_HASH: pendingLendingSpendInfo.scriptPubkey.jet_sha256_hex(),
      LOAN_EXPIRATION_TIME: String(offer.loanExpirationHeight),
      PRINCIPAL_AMOUNT: String(offer.principalAmount),
      PRINCIPAL_ASSET_ID: offer.principalAssetId,
      PRINCIPAL_INTEREST_RATE: String(offer.principalInterestRateBps),
      PRINCIPAL_OUTPUT_SCRIPT_HASH: bytes32ToHex(derivedLendingParams.principalOutputScriptHash),
      PROTOCOL_FEE_KEEPER_ASSET_ID: offer.protocolFeeKeeperAssetId,
      PROTOCOL_FEE_VAULT_COV_HASH: bytes32ToHex(derivedLendingParams.protocolFeeVaultCovHash),
      ZERO_HASH,
    },
    state: { utxos: offer.covenants },
  }
}

function assetIdBytes(assetId: string, label: string) {
  return toBytes32(AssetId.fromString(assetId).toBytes(), label)
}
