import {
  Address,
  AssetId,
  ExternalUtxo,
  OutPoint,
  type Pset,
  Script,
  SimplicityLogLevel,
  type Transaction,
  TxBuilder,
  type TxOut,
  TxOutSecrets,
} from '@lilbonekit/lwk-web'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { NETWORK_CONFIG } from '@/constants/network-config'
import {
  assertDistinctOutpoints,
  assertExplicitAmount,
  assertScriptMatches,
  fetchTransaction,
  requireExplicitAmount,
  requireExplicitAsset,
  requireTxOut,
  type UpdatedPset,
} from '@/lwk/transaction'
import {
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  isPolicyAssetUtxo,
  requireWalletUtxo,
  WALLET_INPUT_RBF_SEQUENCE,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY,
  buildAssetAuthVaultSpendInfo,
  buildAssetAuthVaultWitness,
} from '@/simplicity/asset-auth-vault/program'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLenderVaultProgram,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  buildProtocolFeeVaultProgram,
  LENDING_MAX_WEIGHT_TO_SATISFY,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import {
  getAlreadyUnlockedCollateral,
  getProtocolFee,
  getRepaymentPhase,
  getTotalAmountToRepay,
  getTotalFee,
} from '@/simplicity/lending/utils'
import { bytesToHex } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { minUint64, toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const BURN_PAYLOAD = new TextEncoder().encode('burn')
const BORROWER_NFT_INPUT_INDEX = toUint32(0, 'borrowerNftInputIndex')
const BORROWER_NFT_OUTPUT_INDEX = toUint32(0, 'borrowerNftOutputIndex')

export interface PartialRepayOfferParams {
  activeOfferOutpoint: string
  createOfferTxid: string
  borrowerNftOutpoint: string
  amountToRepay: string
  currentDebt?: string
  lenderVaultOutpoint?: string
  protocolFeeVaultOutpoint?: string
  principalOutpoints: string[]
  feeOutpoints: string[]
  collateralRecipientAddress?: string
  borrowerNftRecipientAddress?: string
}

export interface PartialRepayOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
}

export function usePartialRepayOffer() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const partialRepayOffer = async (
    params: PartialRepayOfferParams,
  ): Promise<UpdatedPset<PartialRepayOfferSummary>> => {
    const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
    const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
    const principalOutpoints = params.principalOutpoints.map(o => new OutPoint(o))
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    const lenderVaultOutpointStr = params.lenderVaultOutpoint?.trim() || null
    const lenderVaultOutpoint = lenderVaultOutpointStr ? new OutPoint(lenderVaultOutpointStr) : null
    const protocolFeeVaultOutpointStr = params.protocolFeeVaultOutpoint?.trim() || null
    const protocolFeeVaultOutpoint = protocolFeeVaultOutpointStr
      ? new OutPoint(protocolFeeVaultOutpointStr)
      : null
    assertDistinctOutpoints(
      [
        activeOfferOutpoint,
        borrowerNftOutpoint,
        ...(lenderVaultOutpoint ? [lenderVaultOutpoint] : []),
        ...(protocolFeeVaultOutpoint ? [protocolFeeVaultOutpoint] : []),
        ...principalOutpoints,
        ...feeOutpoints,
      ],
      'Partial repayment inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const walletReceiveAddress = Address.parse(receiveAddressString, lwkNetwork)
    const collateralRecipient = Address.parse(
      params.collateralRecipientAddress?.trim() || receiveAddressString,
      lwkNetwork,
    )
    const borrowerNftRecipient = Address.parse(
      params.borrowerNftRecipientAddress?.trim() || receiveAddressString,
      lwkNetwork,
    )
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, 'Fee L-BTC'),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error('Fee outpoints must be wallet L-BTC UTXOs')
    }
    const principalWalletUtxos = params.principalOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, 'Principal'),
    )

    const [activeOfferTx, borrowerNftTx, createOfferTx, principalTxs, feeTxs, feeRate] =
      await Promise.all([
        fetchTransaction(activeOfferOutpoint),
        fetchTransaction(borrowerNftOutpoint),
        fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
        Promise.all(principalOutpoints.map(o => fetchTransaction(o))),
        Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
        fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
      ])
    const activeOfferTxOut = requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer')
    const borrowerNftTxOut = requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT')
    // The create-offer tx carries the Lender NFT reference at vout 3 and the pending Lending
    // covenant at vout 5 — fetched once above, reused here instead of two more round trips.
    const lenderNftRefTxOut = requireTxOut(createOfferTx, 3, 'Lender NFT reference')
    const pendingOfferTxOut = requireTxOut(createOfferTx, 5, 'Pending offer Lending')

    const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
    const currentCollateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
    // The compile-time COLLATERAL_AMOUNT must stay the offer's original amount for its whole
    // lifetime — activeOfferTxOut's amount already shrinks after a prior partial repayment, so
    // it can't be reused here once this isn't the first repayment.
    const originalCollateralAmount = requireExplicitAmount(
      pendingOfferTxOut,
      'Pending offer Lending',
    )
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
    const lenderNftAsset = requireExplicitAsset(lenderNftRefTxOut, 'Lender NFT reference')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')
    const metadata = await findPendingOfferMetadata(createOfferTx)
    const principalAsset = AssetId.fromBytes(metadata.principalAssetId)
    const offerParameters = {
      collateralAmount: toUint64(originalCollateralAmount, 'collateralAmount'),
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
      loanExpirationTime: metadata.loanExpirationTime,
    }

    const totalAmountToRepay = getTotalAmountToRepay(offerParameters)
    const currentDebt = params.currentDebt?.trim()
      ? toUint64(BigInt(params.currentDebt.trim()), 'currentDebt')
      : totalAmountToRepay

    const phase = getRepaymentPhase(offerParameters, currentDebt)
    if (phase === 'Repaid') throw new Error('Offer is already fully repaid')
    const needsLenderVaultInput = phase !== 'NoRepayments'
    if (needsLenderVaultInput && !lenderVaultOutpoint) {
      throw new Error('This offer already has an active lender vault — pass its outpoint')
    }
    const needsProtocolFeeVaultInput = phase === 'RepayingOfferFee'
    if (needsProtocolFeeVaultInput && !protocolFeeVaultOutpoint) {
      throw new Error(
        'This offer still has an unpaid fee balance and an active protocol-fee vault — pass its outpoint',
      )
    }

    const amountToRepay = toUint64(BigInt(params.amountToRepay.trim()), 'amountToRepay')
    if (amountToRepay <= 0n) throw new Error('Amount to repay must be greater than zero')
    if (amountToRepay > currentDebt) {
      throw new Error(
        `Amount to repay must not exceed the current debt (${currentDebt.toString()})`,
      )
    }

    for (const principalWalletUtxo of principalWalletUtxos) {
      const actualAssetId = principalWalletUtxo.unblinded().asset().toString()
      if (actualAssetId !== principalAsset.toString()) {
        throw new Error(`Principal UTXO has unexpected asset ${actualAssetId}`)
      }
    }
    const principalInputAmount = principalWalletUtxos.reduce(
      (sum, utxo) => sum + utxo.unblinded().value(),
      0n,
    )
    if (principalInputAmount < amountToRepay) {
      throw new Error(`Principal UTXO amount is lower than ${amountToRepay.toString()}`)
    }
    const principalChangeAmount = principalInputAmount - amountToRepay

    const protocolFeeKeeperAssetId = toBytes32(
      AssetId.fromString(NETWORK_CONFIG.protocolFeeAsset.id).toBytes(),
      'protocolFeeKeeperAssetId',
    )

    const derivedLendingParams = buildDerivedLendingOfferProgramParams({
      collateralAssetId: toBytes32(collateralAsset.toBytes(), 'collateralAssetId'),
      principalAssetId: metadata.principalAssetId,
      borrowerNftAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      lenderNftAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
      protocolFeeKeeperAssetId,
      offerParameters,
    })
    const lendingProgram = loadLendingProgram(derivedLendingParams)
    const activeLendingSpendInfo = buildLendingOfferSpendInfo(
      lendingProgram,
      offerParameters,
      true,
      currentDebt,
    )

    assertScriptMatches(
      activeOfferTxOut.scriptPubkey(),
      activeLendingSpendInfo.scriptPubkey,
      'Active offer output does not match the reconstructed active Lending covenant',
    )

    const isFinalRepayment = amountToRepay === currentDebt
    const newDebt = toUint64(currentDebt - amountToRepay, 'newDebt')

    const totalFee = getTotalFee(offerParameters)
    const totalProtocolFee = getProtocolFee(totalFee)

    const alreadyRepaidAmount = toUint64(totalAmountToRepay - currentDebt, 'alreadyRepaidAmount')
    const alreadyRepaidFee = toUint64(minUint64(totalFee, alreadyRepaidAmount), 'alreadyRepaidFee')
    const alreadyRepaidProtocolFee = getProtocolFee(alreadyRepaidFee)
    const feeLeft = toUint64(totalFee - alreadyRepaidFee, 'feeLeft')
    const feeRepaidNow = toUint64(minUint64(feeLeft, amountToRepay), 'feeRepaidNow')
    const protocolFeeRepaidNow = getProtocolFee(feeRepaidNow)
    const additionalLenderVaultAmount = toUint64(
      amountToRepay - protocolFeeRepaidNow,
      'additionalLenderVaultAmount',
    )
    const lenderVaultAlreadySupplied = toUint64(
      alreadyRepaidAmount - alreadyRepaidProtocolFee,
      'lenderVaultAlreadySupplied',
    )
    const totalRepaidProtocolFee = toUint64(
      alreadyRepaidProtocolFee + protocolFeeRepaidNow,
      'totalRepaidProtocolFee',
    )
    const isProtocolFeeVaultTouchedNow =
      phase === 'NoRepayments' || alreadyRepaidProtocolFee < totalProtocolFee
    const isProtocolFeeVaultFinalized = totalRepaidProtocolFee >= totalProtocolFee

    let lenderVaultTx: Transaction | null = null
    let lenderVaultTxOut: TxOut | null = null
    if (needsLenderVaultInput && lenderVaultOutpoint) {
      lenderVaultTx = await fetchTransaction(lenderVaultOutpoint)
      lenderVaultTxOut = requireTxOut(lenderVaultTx, lenderVaultOutpoint.vout(), 'Lender vault')
    }
    let protocolFeeVaultTx: Transaction | null = null
    let protocolFeeVaultTxOut: TxOut | null = null
    if (needsProtocolFeeVaultInput && protocolFeeVaultOutpoint) {
      protocolFeeVaultTx = await fetchTransaction(protocolFeeVaultOutpoint)
      protocolFeeVaultTxOut = requireTxOut(
        protocolFeeVaultTx,
        protocolFeeVaultOutpoint.vout(),
        'Protocol fee vault',
      )
    }

    const lenderVaultProgram = buildLenderVaultProgram(derivedLendingParams)
    const lenderVaultInputSpendInfo = needsLenderVaultInput
      ? buildAssetAuthVaultSpendInfo(lenderVaultProgram, {
          isActive: true,
          alreadySupplied: lenderVaultAlreadySupplied,
        })
      : null

    if (needsLenderVaultInput && lenderVaultTxOut && lenderVaultInputSpendInfo) {
      assertScriptMatches(
        lenderVaultTxOut.scriptPubkey(),
        lenderVaultInputSpendInfo.scriptPubkey,
        'Lender vault output does not match the reconstructed active AssetAuthVault covenant',
      )
    }

    const lenderVaultInputAmount = lenderVaultTxOut
      ? requireExplicitAmount(lenderVaultTxOut, 'Lender vault')
      : 0n
    const lenderVaultOutputAmount = toUint64(
      lenderVaultInputAmount + additionalLenderVaultAmount,
      'lenderVaultOutputAmount',
    )
    const lenderVaultNewAlreadySupplied = isFinalRepayment
      ? derivedLendingParams.lenderVaultSupplyGoal
      : toUint64(
          lenderVaultAlreadySupplied + additionalLenderVaultAmount,
          'lenderVaultNewAlreadySupplied',
        )
    const lenderVaultOutputSpendInfo = buildAssetAuthVaultSpendInfo(lenderVaultProgram, {
      isActive: !isFinalRepayment,
      alreadySupplied: lenderVaultNewAlreadySupplied,
    })

    const protocolFeeVaultProgram = buildProtocolFeeVaultProgram(derivedLendingParams)
    const protocolFeeVaultInputSpendInfo = needsProtocolFeeVaultInput
      ? buildAssetAuthVaultSpendInfo(protocolFeeVaultProgram, {
          isActive: true,
          alreadySupplied: alreadyRepaidProtocolFee,
        })
      : null

    if (needsProtocolFeeVaultInput && protocolFeeVaultTxOut && protocolFeeVaultInputSpendInfo) {
      assertScriptMatches(
        protocolFeeVaultTxOut.scriptPubkey(),
        protocolFeeVaultInputSpendInfo.scriptPubkey,
        'Protocol fee vault output does not match the reconstructed active AssetAuthVault covenant',
      )
    }

    const protocolFeeVaultInputAmount = protocolFeeVaultTxOut
      ? requireExplicitAmount(protocolFeeVaultTxOut, 'Protocol fee vault')
      : 0n
    const protocolFeeVaultOutputAmount = toUint64(
      protocolFeeVaultInputAmount + protocolFeeRepaidNow,
      'protocolFeeVaultOutputAmount',
    )
    if (isProtocolFeeVaultTouchedNow && protocolFeeVaultOutputAmount === 0n) {
      throw new Error(
        'Amount to repay is too small: it would create a zero-satoshi protocol-fee vault output, ' +
          'which the network rejects at broadcast. Increase the amount to repay.',
      )
    }
    const protocolFeeVaultOutputSpendInfo = isProtocolFeeVaultTouchedNow
      ? buildAssetAuthVaultSpendInfo(protocolFeeVaultProgram, {
          isActive: !isProtocolFeeVaultFinalized,
          alreadySupplied: totalRepaidProtocolFee,
        })
      : null

    const burnScript = Script.newOpReturn(BURN_PAYLOAD)
    const walletInputOutpointStrings = [...params.principalOutpoints, ...params.feeOutpoints]
    const inputOrderStrings = [
      params.borrowerNftOutpoint,
      params.activeOfferOutpoint,
      ...(lenderVaultOutpointStr ? [lenderVaultOutpointStr] : []),
      ...(protocolFeeVaultOutpointStr ? [protocolFeeVaultOutpointStr] : []),
      ...walletInputOutpointStrings,
    ]
    const lenderVaultInputIndex = 2
    const protocolFeeVaultInputIndex = 3
    const firstWalletOutpoint = walletInputOutpointStrings[0]
    if (!firstWalletOutpoint) throw new Error('At least one wallet UTXO is required')

    const externalUtxos = [
      new ExternalUtxo(
        borrowerNftOutpoint.vout(),
        borrowerNftTx,
        TxOutSecrets.fromExplicit(borrowerNftAsset, NFT_AMOUNT),
        EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        true,
      ),
      new ExternalUtxo(
        activeOfferOutpoint.vout(),
        activeOfferTx,
        TxOutSecrets.fromExplicit(collateralAsset, currentCollateralAmount),
        isFinalRepayment
          ? LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment
          : LENDING_MAX_WEIGHT_TO_SATISFY.PartialRepayment,
        true,
      ),
    ]
    if (needsLenderVaultInput && lenderVaultOutpoint && lenderVaultTx) {
      externalUtxos.push(
        new ExternalUtxo(
          lenderVaultOutpoint.vout(),
          lenderVaultTx,
          TxOutSecrets.fromExplicit(principalAsset, lenderVaultInputAmount),
          isFinalRepayment
            ? ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.FinalSupply
            : ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.Supply,
          true,
        ),
      )
    }
    if (needsProtocolFeeVaultInput && protocolFeeVaultOutpoint && protocolFeeVaultTx) {
      externalUtxos.push(
        new ExternalUtxo(
          protocolFeeVaultOutpoint.vout(),
          protocolFeeVaultTx,
          TxOutSecrets.fromExplicit(principalAsset, protocolFeeVaultInputAmount),
          isProtocolFeeVaultFinalized
            ? ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.FinalSupply
            : ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.Supply,
          true,
        ),
      )
    }

    let txBuilder = new TxBuilder(lwkNetwork)
      .feeRate(feeRate)
      .setWalletUtxos(walletInputOutpointStrings.map(o => new OutPoint(o)))
      .setInputOrder(inputOrderStrings.map(o => new OutPoint(o)))
      .addExternalUtxos(externalUtxos)

    let newActiveOfferScriptHex = ''
    let lenderVaultOutputIndex: number
    let protocolFeeVaultOutputIndex: number
    if (isFinalRepayment) {
      lenderVaultOutputIndex = 1
      protocolFeeVaultOutputIndex = 2
      txBuilder = txBuilder
        .addPostIssuanceScriptOutput(burnScript, NFT_AMOUNT, borrowerNftAsset)
        .addPostIssuanceScriptOutput(
          lenderVaultOutputSpendInfo.scriptPubkey,
          lenderVaultOutputAmount,
          principalAsset,
        )
      if (protocolFeeVaultOutputSpendInfo) {
        txBuilder = txBuilder.addPostIssuanceScriptOutput(
          protocolFeeVaultOutputSpendInfo.scriptPubkey,
          protocolFeeVaultOutputAmount,
          principalAsset,
        )
      }
      txBuilder = txBuilder.addPostIssuanceRecipient(
        collateralRecipient,
        currentCollateralAmount,
        collateralAsset,
      )
    } else {
      lenderVaultOutputIndex = 2
      protocolFeeVaultOutputIndex = 3
      const collateralToUnlock = toUint64(
        getAlreadyUnlockedCollateral(offerParameters, newDebt) -
          getAlreadyUnlockedCollateral(offerParameters, currentDebt),
        'collateralToUnlock',
      )
      const newCollateralAmount = currentCollateralAmount - collateralToUnlock
      const newActiveOfferSpendInfo = buildLendingOfferSpendInfo(
        lendingProgram,
        offerParameters,
        true,
        newDebt,
      )
      newActiveOfferScriptHex = bytesToHex(newActiveOfferSpendInfo.scriptPubkey.bytes())

      txBuilder = txBuilder
        .addPostIssuanceScriptOutput(
          borrowerNftRecipient.scriptPubkey(),
          NFT_AMOUNT,
          borrowerNftAsset,
        )
        .addPostIssuanceScriptOutput(
          newActiveOfferSpendInfo.scriptPubkey,
          newCollateralAmount,
          collateralAsset,
        )
        .addPostIssuanceScriptOutput(
          lenderVaultOutputSpendInfo.scriptPubkey,
          lenderVaultOutputAmount,
          principalAsset,
        )
      if (protocolFeeVaultOutputSpendInfo) {
        txBuilder = txBuilder.addPostIssuanceScriptOutput(
          protocolFeeVaultOutputSpendInfo.scriptPubkey,
          protocolFeeVaultOutputAmount,
          principalAsset,
        )
      }
      txBuilder = txBuilder.addPostIssuanceRecipient(
        collateralRecipient,
        collateralToUnlock,
        collateralAsset,
      )
    }

    if (principalChangeAmount > 0n) {
      txBuilder = txBuilder.addPostIssuanceRecipient(
        walletReceiveAddress,
        principalChangeAmount,
        principalAsset,
      )
    }

    txBuilder = txBuilder.setInputSequence(
      new OutPoint(firstWalletOutpoint),
      WALLET_INPUT_RBF_SEQUENCE,
    )
    const pset = txBuilder.finish(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const txWithWalletWitnesses = wollet.finalize(signedPset).extractTx()

        const buildPrevouts = () => [
          requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT'),
          requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer'),
          ...(needsLenderVaultInput && lenderVaultTx && lenderVaultOutpoint
            ? [requireTxOut(lenderVaultTx, lenderVaultOutpoint.vout(), 'Lender vault')]
            : []),
          ...(needsProtocolFeeVaultInput && protocolFeeVaultTx && protocolFeeVaultOutpoint
            ? [
                requireTxOut(
                  protocolFeeVaultTx,
                  protocolFeeVaultOutpoint.vout(),
                  'Protocol fee vault',
                ),
              ]
            : []),
          ...principalTxs.map((tx, index) =>
            requireTxOut(tx, principalOutpoints[index].vout(), 'Principal'),
          ),
          ...feeTxs.map((tx, index) => requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC')),
        ]

        let finalizedTx = lendingProgram.finalizeTransactionWithSpendInfo(
          txWithWalletWitnesses,
          activeLendingSpendInfo,
          buildPrevouts(),
          1, // Lending covenant is at input index 1
          isFinalRepayment
            ? buildLendingWitness({ branch: 'FullRepayment', currentDebt })
            : buildLendingWitness({ branch: 'PartialRepayment', currentDebt, amountToRepay }),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        if (needsLenderVaultInput && lenderVaultInputSpendInfo) {
          const lenderVaultWitness = isFinalRepayment
            ? buildAssetAuthVaultWitness({
                branch: 'FinalSupply',
                inputSupplierIndex: BORROWER_NFT_INPUT_INDEX,
                outputSupplierIndex: BORROWER_NFT_OUTPUT_INDEX,
                finalizedVaultOutputIndex: toUint32(
                  lenderVaultOutputIndex,
                  'lenderVaultOutputIndex',
                ),
                alreadySupplied: lenderVaultAlreadySupplied,
              })
            : buildAssetAuthVaultWitness({
                branch: 'Supply',
                inputSupplierIndex: BORROWER_NFT_INPUT_INDEX,
                outputSupplierIndex: BORROWER_NFT_OUTPUT_INDEX,
                vaultOutputIndex: toUint32(lenderVaultOutputIndex, 'lenderVaultOutputIndex'),
                alreadySupplied: lenderVaultAlreadySupplied,
                amountToSupply: additionalLenderVaultAmount,
              })

          finalizedTx = lenderVaultProgram.finalizeTransactionWithSpendInfo(
            finalizedTx,
            lenderVaultInputSpendInfo,
            buildPrevouts(),
            lenderVaultInputIndex,
            lenderVaultWitness,
            lwkNetwork,
            SimplicityLogLevel.Trace,
          )
        }

        if (needsProtocolFeeVaultInput && protocolFeeVaultInputSpendInfo) {
          const protocolFeeVaultWitness = isProtocolFeeVaultFinalized
            ? buildAssetAuthVaultWitness({
                branch: 'FinalSupply',
                inputSupplierIndex: BORROWER_NFT_INPUT_INDEX,
                outputSupplierIndex: BORROWER_NFT_OUTPUT_INDEX,
                finalizedVaultOutputIndex: toUint32(
                  protocolFeeVaultOutputIndex,
                  'protocolFeeVaultOutputIndex',
                ),
                alreadySupplied: alreadyRepaidProtocolFee,
              })
            : buildAssetAuthVaultWitness({
                branch: 'Supply',
                inputSupplierIndex: BORROWER_NFT_INPUT_INDEX,
                outputSupplierIndex: BORROWER_NFT_OUTPUT_INDEX,
                vaultOutputIndex: toUint32(
                  protocolFeeVaultOutputIndex,
                  'protocolFeeVaultOutputIndex',
                ),
                alreadySupplied: alreadyRepaidProtocolFee,
                amountToSupply: protocolFeeRepaidNow,
              })

          finalizedTx = protocolFeeVaultProgram.finalizeTransactionWithSpendInfo(
            finalizedTx,
            protocolFeeVaultInputSpendInfo,
            buildPrevouts(),
            protocolFeeVaultInputIndex,
            protocolFeeVaultWitness,
            lwkNetwork,
            SimplicityLogLevel.Trace,
          )
        }

        const principalChangeSummary =
          principalChangeAmount > 0n
            ? `${principalChangeAmount.toString()} to ${walletReceiveAddress.toString()}`
            : 'None'

        const outputs: Record<string, string> = {}
        if (isFinalRepayment) {
          outputs['0 Borrower NFT burn'] = bytesToHex(burnScript.bytes())
          outputs['1 Lender vault (finalized)'] = bytesToHex(
            lenderVaultOutputSpendInfo.scriptPubkey.bytes(),
          )
          if (protocolFeeVaultOutputSpendInfo) {
            outputs['2 Protocol fee vault (finalized)'] = bytesToHex(
              protocolFeeVaultOutputSpendInfo.scriptPubkey.bytes(),
            )
          }
          outputs['Unlocked collateral'] = collateralRecipient.toString()
        } else {
          outputs['0 Borrower NFT (returned)'] = borrowerNftRecipient.toString()
          outputs['1 New active offer Lending'] = newActiveOfferScriptHex
          outputs['2 Lender vault (active)'] = bytesToHex(
            lenderVaultOutputSpendInfo.scriptPubkey.bytes(),
          )
          if (protocolFeeVaultOutputSpendInfo) {
            outputs[
              `3 Protocol fee vault (${isProtocolFeeVaultFinalized ? 'finalized' : 'active'})`
            ] = bytesToHex(protocolFeeVaultOutputSpendInfo.scriptPubkey.bytes())
          }
          outputs['Unlocked collateral (partial)'] = collateralRecipient.toString()
        }
        outputs['Principal change'] = principalChangeSummary

        return {
          finalizedTx,
          // TODO: Remove debug summary before release
          summary: {
            inputs: {
              '0 Borrower NFT': params.borrowerNftOutpoint,
              '1 Active offer Lending': params.activeOfferOutpoint,
              ...(lenderVaultOutpointStr ? { '2 Lender vault': lenderVaultOutpointStr } : {}),
              ...(protocolFeeVaultOutpointStr
                ? { '3 Protocol fee vault': protocolFeeVaultOutpointStr }
                : {}),
              'Principal wallet UTXO(s)': params.principalOutpoints.join(', '),
              'Fee L-BTC (wallet)': params.feeOutpoints.join(', '),
            },
            outputs,
            assetIds: {
              collateralAssetId: collateralAsset.toString(),
              principalAssetId: principalAsset.toString(),
              borrowerNftAssetId: borrowerNftAsset.toString(),
              lenderNftAssetId: lenderNftAsset.toString(),
            },
            amounts: {
              phase,
              currentDebt: currentDebt.toString(),
              amountToRepay: amountToRepay.toString(),
              newDebt: (isFinalRepayment ? 0n : newDebt).toString(),
              isFinalRepayment: isFinalRepayment.toString(),
              totalFee: totalFee.toString(),
              totalProtocolFee: totalProtocolFee.toString(),
              lenderVaultOutputAmount: lenderVaultOutputAmount.toString(),
              protocolFeeVaultOutputAmount: protocolFeeVaultOutputAmount.toString(),
              principalInputAmount: principalInputAmount.toString(),
              principalChangeAmount: principalChangeAmount.toString(),
            },
          },
        }
      },
    }
  }

  return { partialRepayOffer }
}
