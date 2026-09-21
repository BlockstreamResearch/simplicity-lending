/**
 * One protocol action, performed by a wallet that signs in this page.
 *
 * The extension performs an action inside itself: it is handed the document and works out for
 * itself which output pays for what, where every input and output lands and what each covenant
 * address is. A wallet that only holds a key cannot, so this does that part here — and then hands
 * the transaction to the same builder that has always built it.
 *
 * The document is what says how. Every input it declares is one of two kinds: one the wallet finds
 * for itself, named by asset and amount, and one located in the deployment's own state by the type
 * the document gives it. That rule is followed here rather than restated, so this file decides
 * nothing about lending — it resolves inputs, calls the builder for the named action, and lets the
 * builder's own covenant check refuse anything that does not add up.
 */

import { type AssetId, OutPoint, type Pset, type Transaction } from '@lilbonekit/lwk-web'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { broadcastTx } from '@/api/esplora/methods'
import type { ProtocolBuilderAccess } from '@/lib/wallet/protocolBuilderAccess'
import { fetchTransaction, type UpdatedPset } from '@/lwk/transaction'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectAssetUtxos,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import type { ProtocolActionRequest, ProtocolStateUtxo } from '@/protocol/actionRequest'
import { acceptOfferBuilder } from '@/protocol/actions/acceptOffer'
import { cancelOfferBuilder } from '@/protocol/actions/cancelOffer'
import { claimPrincipalBuilder } from '@/protocol/actions/claimPrincipal'
import { createFactoryBuilder } from '@/protocol/actions/createFactory'
import { createOfferBuilder } from '@/protocol/actions/createOffer'
import { lenderVaultClaimBuilder } from '@/protocol/actions/lenderVaultClaim'
import { liquidateOfferBuilder } from '@/protocol/actions/liquidateOffer'
import { repayOfferBuilder } from '@/protocol/actions/repayOffer'
import { ASSET_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth/program'
import { ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth-vault/program'
import { ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/issuance-factory/program'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/script-auth/program'
import { toUint16, toUint64 } from '@/utils/uint'

/** What performing an action needs beyond building it: the key, and what to do once it is sent. */
export interface ProtocolActionAccess extends ProtocolBuilderAccess {
  signPset(pset: Pset): Promise<Pset>
  applyBroadcastTransaction(tx: Transaction): void
}

/** What the wallet answers with, in the shape the facade's callers already read. */
export interface LocalActionResult {
  txid: string
  deployment: Record<string, string> | null
}

const NFT_AMOUNT = 1n

/** The action names the deployed document declares, against the builder that performs each. */
const PERFORMED = [
  'CreateFactory',
  'CreateOffer',
  'AcceptOffer',
  'CancelOffer',
  'ClaimPrincipal',
  'RepayLoan',
  'LiquidateOffer',
  'ClaimLenderVault',
] as const

type PerformedAction = (typeof PERFORMED)[number]

function isPerformed(action: string): action is PerformedAction {
  return (PERFORMED as readonly string[]).includes(action)
}

/**
 * A value the deployment states, wherever this action carries it.
 *
 * Creating a deployment carries its values as parameters, because there is no deployment yet to
 * read them from; every action after it carries the deployment itself. One lookup over both, so
 * nothing here has to know which kind of action it is resolving for.
 */
function stated(request: ProtocolActionRequest, field: string): string {
  const fromInstance = request.instance?.instance.fields[field]
  const fromParams = request.params[field]
  const value = fromInstance ?? (typeof fromParams === 'string' ? fromParams : undefined)

  if (value === undefined) {
    throw new Error(`This action carries no ${field}, which performing it here needs.`)
  }

  return value
}

/** The one covenant output of this type the deployment holds, as `txid:vout`. */
function covenant(request: ProtocolActionRequest, utxoType: string): string {
  const found = (request.state?.utxos ?? []).filter(
    (utxo: ProtocolStateUtxo) => utxo.utxo_type === utxoType,
  )

  if (found.length === 0) {
    throw new Error(`This deployment has no ${utxoType} output for the action to spend.`)
  }

  if (found.length > 1) {
    throw new Error(
      `This deployment reports ${found.length} ${utxoType} outputs, and the action spends one.`,
    )
  }

  return `${found[0]!.txid}:${found[0]!.vout}`
}

/** The account's own outputs of one asset, enough to cover an amount. */
async function walletOutpoints(
  access: ProtocolActionAccess,
  assetId: AssetId | string,
  amount: bigint,
  label: string,
): Promise<string[]> {
  const utxos = await access.getBlindedWalletUtxos()

  return selectAssetUtxos(utxos, assetId, amount, label).map(utxoToOutpointString)
}

/**
 * The account's L-BTC outputs, enough to pay for a transaction of this shape.
 *
 * What the action already spends is excluded. The document declares the fee input separately from
 * whatever the action itself moves, and where a deployment's principal or collateral is the policy
 * asset the same output satisfies both descriptions — offered twice, it is one output spent twice.
 */
async function feeOutpoints(
  access: ProtocolActionAccess,
  externalWeightUnits: number,
  walletInputsCount: number,
  alreadySpending: readonly string[] = [],
): Promise<string[]> {
  const [utxos, feeRate] = await Promise.all([
    access.getBlindedWalletUtxos(),
    fetchFeeRateSatPerKvbAbovePending(access.processingTxids),
  ])
  const available = utxos.filter(utxo => !alreadySpending.includes(utxoToOutpointString(utxo)))
  const budget = estimateFeeBudgetSats(externalWeightUnits, feeRate, walletInputsCount)

  return selectFeeUtxos(available, access.lwkNetwork.policyAsset(), budget, feeRate).map(
    utxoToOutpointString,
  )
}

/** Where anything this action returns to the account is sent. */
async function receiveAddress(access: ProtocolActionAccess): Promise<string> {
  const address = await access.getReceiveAddress()

  if (!address) throw new Error('This wallet did not say where this account receives.')

  return address
}

/**
 * The transaction that created this deployment, walked back to from what the action spends.
 *
 * Two things are only recorded there: the offer's own terms, in an OP_RETURN, and the borrower's
 * NFT, at the output the creating transaction puts it at. An action that spends the active offer
 * reaches it through the acceptance that created that output, whose first input is the pending
 * offer the deployment started as.
 */
async function creatingTxid(activeOfferOutpoint: string): Promise<string> {
  const acceptance = await fetchTransaction(new OutPoint(activeOfferOutpoint))

  return acceptance.inputs[0]!.outpoint().txid().toString()
}

/** Builds the transaction one action asks for, with every input this wallet has to choose. */
async function buildAction(
  access: ProtocolActionAccess,
  request: ProtocolActionRequest,
  action: PerformedAction,
): Promise<UpdatedPset<unknown>> {
  // The outputs about to be selected have to be the ones that still exist, so the chain is reread
  // first. Every builder does the same before listing outputs, for the same reason.
  await access.syncWallet()

  switch (action) {
    case 'CreateFactory': {
      // The one action that reads nothing: there is no deployment yet, and the account funds the
      // issuance from an output the builder picks itself.
      return createFactoryBuilder(access).createBorrowerAccount()
    }

    case 'CreateOffer': {
      const factoryAssetId = stated(request, 'FACTORY_ASSET_ID')
      const collateralAssetId = stated(request, 'COLLATERAL_ASSET_ID')
      const collateralAmount = BigInt(stated(request, 'COLLATERAL_AMOUNT'))
      // The collateral is the policy asset, and the fee comes out of the same inputs, so enough
      // has to be selected for both. The reserve is the one the create-offer screen already sizes.
      const feeRate = await fetchFeeRateSatPerKvbAbovePending(access.processingTxids)
      const reserve = estimateFeeBudgetSats(
        EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY +
          ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY.IssueAssets,
        feeRate,
        1,
      )
      const [factoryAuth, collateral] = await Promise.all([
        walletOutpoints(access, factoryAssetId, NFT_AMOUNT, 'Factory auth NFT'),
        walletOutpoints(access, collateralAssetId, collateralAmount + reserve, 'Collateral'),
      ])

      return createOfferBuilder(access).createOffer({
        factoryAuthOutpoint: factoryAuth[0]!,
        issuanceFactoryOutpoint: covenant(request, 'issuance_factory'),
        factoryAssetId,
        collateralOutpoints: collateral,
        collateralAmount,
        principalAssetId: stated(request, 'PRINCIPAL_ASSET_ID'),
        principalAmount: BigInt(stated(request, 'PRINCIPAL_AMOUNT')),
        principalInterestRate: Number(stated(request, 'PRINCIPAL_INTEREST_RATE')),
        loanDurationBlocks: 0,
        loanExpirationTime: Number(stated(request, 'LOAN_EXPIRATION_TIME')),
        protocolFeeKeeperAssetId: stated(request, 'PROTOCOL_FEE_KEEPER_ASSET_ID'),
      })
    }

    case 'AcceptOffer': {
      const pendingOfferOutpoint = covenant(request, 'lending_collateral')
      const principal = await walletOutpoints(
        access,
        stated(request, 'PRINCIPAL_ASSET_ID'),
        BigInt(stated(request, 'PRINCIPAL_AMOUNT')),
        'Principal',
      )
      const fee = await feeOutpoints(
        access,
        LENDING_MAX_WEIGHT_TO_SATISFY.OfferAcceptance + SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
        principal.length + 1,
        principal,
      )

      return acceptOfferBuilder(access).acceptOffer({
        pendingOfferOutpoint,
        lenderNftOutpoint: covenant(request, 'lender_nft_script_auth'),
        // The borrower's NFT is a reference here, read for its asset id alone. It is at the
        // output the creating transaction puts it at, which is the transaction the pending offer
        // came from.
        borrowerNftReferenceOutpoint: `${pendingOfferOutpoint.split(':')[0]!}:2`,
        principalOutpoints: principal,
        feeOutpoints: fee,
      })
    }

    case 'CancelOffer': {
      const borrowerNft = await walletOutpoints(
        access,
        stated(request, 'BORROWER_NFT_ASSET_ID'),
        NFT_AMOUNT,
        'Borrower NFT',
      )
      const fee = await feeOutpoints(
        access,
        LENDING_MAX_WEIGHT_TO_SATISFY.OfferCancellation +
          SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY +
          EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        2,
        borrowerNft,
      )

      return cancelOfferBuilder(access).cancelOffer({
        pendingOfferOutpoint: covenant(request, 'lending_collateral'),
        lenderNftOutpoint: covenant(request, 'lender_nft_script_auth'),
        borrowerNftOutpoint: borrowerNft[0]!,
        collateralRecipientAddress: await receiveAddress(access),
        feeOutpoints: fee,
      })
    }

    case 'ClaimPrincipal': {
      const borrowerNft = await walletOutpoints(
        access,
        stated(request, 'BORROWER_NFT_ASSET_ID'),
        NFT_AMOUNT,
        'Borrower NFT',
      )
      const fee = await feeOutpoints(
        access,
        ASSET_AUTH_MAX_WEIGHT_TO_SATISFY + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        2,
        borrowerNft,
      )

      return claimPrincipalBuilder(access).claimPrincipal({
        principalOutpoint: covenant(request, 'principal_asset_auth'),
        borrowerNftOutpoint: borrowerNft[0]!,
        feeOutpoints: fee,
      })
    }

    case 'RepayLoan': {
      // What is owed, worked out the way the covenant works it out. A wallet output short of it
      // would be selected, spent on and refused by the covenant rather than by this.
      const debt = getTotalAmountToRepay({
        principalAmount: toUint64(BigInt(stated(request, 'PRINCIPAL_AMOUNT')), 'principalAmount'),
        principalInterestRate: toUint16(
          Number(stated(request, 'PRINCIPAL_INTEREST_RATE')),
          'principalInterestRate',
        ),
      })
      const [borrowerNft, repayment] = await Promise.all([
        walletOutpoints(
          access,
          stated(request, 'BORROWER_NFT_ASSET_ID'),
          NFT_AMOUNT,
          'Borrower NFT',
        ),
        walletOutpoints(access, stated(request, 'PRINCIPAL_ASSET_ID'), debt, 'Repayment'),
      ])
      const fee = await feeOutpoints(
        access,
        LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        repayment.length + 1,
        [...borrowerNft, ...repayment],
      )

      return repayOfferBuilder(access).repayOffer({
        activeOfferOutpoint: covenant(request, 'lending_collateral_active'),
        borrowerNftOutpoint: borrowerNft[0]!,
        principalOutpoints: repayment,
        feeOutpoints: fee,
      })
    }

    case 'LiquidateOffer': {
      const activeOfferOutpoint = covenant(request, 'lending_collateral_active')
      const lenderNft = await walletOutpoints(
        access,
        stated(request, 'LENDER_NFT_ASSET_ID'),
        NFT_AMOUNT,
        'Lender NFT',
      )
      const fee = await feeOutpoints(
        access,
        LENDING_MAX_WEIGHT_TO_SATISFY.Liquidation + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        2,
        lenderNft,
      )

      return liquidateOfferBuilder(access).liquidateOffer({
        activeOfferOutpoint,
        createOfferTxid: await creatingTxid(activeOfferOutpoint),
        lenderNftOutpoint: lenderNft[0]!,
        feeOutpoints: fee,
      })
    }

    case 'ClaimLenderVault': {
      const lenderNft = await walletOutpoints(
        access,
        stated(request, 'LENDER_NFT_ASSET_ID'),
        NFT_AMOUNT,
        'Lender NFT',
      )
      const fee = await feeOutpoints(
        access,
        ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawAll +
          EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        2,
        lenderNft,
      )

      return lenderVaultClaimBuilder(access).claimLenderVault({
        lenderVaultOutpoint: covenant(request, 'lender_vault_finalized'),
        lenderNftOutpoint: lenderNft[0]!,
        feeOutpoints: fee,
      })
    }
  }
}

/** The deployment an action created, in the field names the document gives them. */
function deploymentFrom(action: PerformedAction, summary: unknown): Record<string, string> | null {
  if (action === 'CreateFactory') {
    // What creating a factory establishes: the asset every offer minted through it carries. The
    // document's own constructor names it this, and the screens read the factory back from the
    // indexer rather than from here.
    const issued = (summary as { issuedAssetId?: string }).issuedAssetId

    return issued === undefined ? null : { FACTORY_ASSET_ID: issued }
  }

  if (action !== 'CreateOffer') return null

  const assetIds = (summary as { assetIds?: Record<string, string> }).assetIds

  if (!assetIds) return null

  return {
    BORROWER_NFT_ASSET_ID: assetIds.borrowerNftAssetId ?? '',
    COLLATERAL_ASSET_ID: assetIds.collateralAssetId ?? '',
    FACTORY_ASSET_ID: assetIds.factoryAssetId ?? '',
    LENDER_NFT_ASSET_ID: assetIds.lenderNftAssetId ?? '',
    PRINCIPAL_ASSET_ID: assetIds.principalAssetId ?? '',
    PROTOCOL_FEE_KEEPER_ASSET_ID: assetIds.protocolFeeKeeperAssetId ?? '',
  }
}

/**
 * Performs one protocol action with a key this page can reach.
 *
 * Built, signed, finalized and sent, in that order, which is the order the covenant needs: the
 * wallet's own witnesses go in first, and each covenant's Simplicity witness after them.
 */
export async function performProtocolActionLocally(
  access: ProtocolActionAccess,
  request: ProtocolActionRequest,
): Promise<LocalActionResult> {
  const action = request.action

  if (!isPerformed(action)) {
    throw new Error(`This wallet cannot perform ${action} in this page.`)
  }

  const { pset, finalize } = await buildAction(access, request, action)
  const signed = await access.signPset(pset)
  const { finalizedTx, summary } = finalize(signed)
  const txid = await broadcastTx(finalizedTx.toString())

  access.applyBroadcastTransaction(finalizedTx)

  return { txid, deployment: deploymentFrom(action, summary) }
}
