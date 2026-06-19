import {
  Address,
  AssetId,
  ExternalUtxo,
  OutPoint,
  Script,
  SimplicityLogLevel,
  TxBuilder,
  TxOutSecrets,
} from 'lwk_web'

import { broadcastTx } from '@/api/esplora/methods'
import { NETWORK_CONFIG } from '@/constants/network-config'
import {
  assertDistinctOutpoints,
  assertExplicitAmount,
  assertScriptMatches,
  fetchTransaction,
  requireExplicitAmount,
  requireExplicitAsset,
  requireTxOut,
} from '@/lwk/transaction'
import {
  assertWalletUtxoAssetAndMinimumAmount,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  isPolicyAssetUtxo,
  requireWalletUtxo,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadAssetAuthVaultProgram } from '@/simplicity/asset-auth-vault/program'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  LENDING_MAX_WEIGHT_TO_SATISFY,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { wrapErrorWithContext } from '@/utils/errorHandler'
import { bytesToHex } from '@/utils/hex'
import { toBytes32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const DEFAULT_FEE_RATE = 100
const BURN_PAYLOAD = new TextEncoder().encode('burn')

// 10% of the total fee goes to the protocol, matching PROTOCOL_FEE_PERCENTAGE in Rust.
// Check crates/contracts/src/programs/lending/offer.rs)
const PROTOCOL_FEE_BPS = 1_000n
const BASIS_POINTS = 10_000n

function getTotalProtocolFee(totalFee: bigint): bigint {
  return (totalFee * PROTOCOL_FEE_BPS) / BASIS_POINTS
}

export interface RepayOfferParams {
  activeOfferOutpoint: string
  borrowerNftOutpoint: string
  principalOutpoint: string
  feeOutpoint: string
  collateralRecipientAddress?: string
}

export interface RepayOfferResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
    amounts: Record<string, string>
  }
}

export function useRepayOffer() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const repayOffer = async (params: RepayOfferParams): Promise<RepayOfferResult> => {
    let stage = 'initializing'

    try {
      stage = 'parse input outpoints'
      const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
      const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
      const principalOutpoint = new OutPoint(params.principalOutpoint)
      const feeOutpoint = new OutPoint(params.feeOutpoint)
      assertDistinctOutpoints(
        [activeOfferOutpoint, borrowerNftOutpoint, principalOutpoint, feeOutpoint],
        'Repayment inputs must use four distinct outpoints',
      )

      stage = 'load wallet context'
      const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
      if (!receiveAddressString) throw new Error('Missing wallet receive address')
      const walletReceiveAddress = Address.parse(receiveAddressString, lwkNetwork)
      const collateralRecipient = Address.parse(
        params.collateralRecipientAddress?.trim() || receiveAddressString,
        lwkNetwork,
      )

      stage = 'sync wallet and verify fee input'
      await syncWallet()
      const blindedWalletUtxos = await getBlindedWalletUtxos()
      const feeUtxo = requireWalletUtxo(blindedWalletUtxos, params.feeOutpoint, 'Fee L-BTC')
      if (!isPolicyAssetUtxo(feeUtxo, lwkNetwork.policyAsset())) {
        throw new Error('Fee outpoint must be a wallet L-BTC UTXO')
      }
      const principalWalletUtxo = requireWalletUtxo(
        blindedWalletUtxos,
        params.principalOutpoint,
        'Principal',
      )

      stage = 'fetch active offer and borrower NFT transactions'
      const [activeOfferTx, borrowerNftTx] = await Promise.all([
        fetchTransaction(activeOfferOutpoint),
        fetchTransaction(borrowerNftOutpoint),
      ])

      stage = 'trace back to pending offer transaction for metadata'
      const pendingOfferOutpoint = activeOfferTx.inputs[0].outpoint()
      const [pendingOfferTx, principalTx, feeTx] = await Promise.all([
        fetchTransaction(pendingOfferOutpoint),
        fetchTransaction(principalOutpoint),
        fetchTransaction(feeOutpoint),
      ])

      stage = 'extract UTXO values from transactions'
      const activeOfferTxOut = requireTxOut(
        activeOfferTx,
        activeOfferOutpoint.vout(),
        'Active offer',
      )
      const borrowerNftTxOut = requireTxOut(
        borrowerNftTx,
        borrowerNftOutpoint.vout(),
        'Borrower NFT',
      )
      const lenderNftTxOut = requireTxOut(activeOfferTx, 2, 'Lender NFT reference')
      const principalTxOut = requireTxOut(principalTx, principalOutpoint.vout(), 'Principal')
      const feeTxOut = requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC')

      const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
      const collateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
      const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
      const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT reference')
      assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')

      stage = 'recover pending offer parameters'
      const metadata = await findPendingOfferMetadata(pendingOfferTx)
      const principalAsset = AssetId.fromBytes(metadata.principalAssetId)

      stage = 'verify principal wallet UTXO'
      const offerParameters = {
        collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
        principalAmount: metadata.principalAmount,
        principalInterestRate: metadata.principalInterestRate,
        loanExpirationTime: metadata.loanExpirationTime,
      }
      const totalAmountToRepay = getTotalAmountToRepay(offerParameters)
      assertWalletUtxoAssetAndMinimumAmount(
        principalWalletUtxo,
        principalAsset,
        totalAmountToRepay,
        'Principal',
      )
      const principalInputAmount = principalWalletUtxo.unblinded().value()
      const principalChangeAmount = principalInputAmount - totalAmountToRepay

      stage = 'compile Lending and AssetAuthVault programs'
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
      )

      assertScriptMatches(
        activeOfferTxOut.scriptPubkey(),
        activeLendingSpendInfo.scriptPubkey,
        'Active offer output does not match the reconstructed active Lending covenant',
      )

      const finalizedLenderVaultProgram = loadAssetAuthVaultProgram({
        vaultAssetId: derivedLendingParams.principalAssetId,
        keeperAuthAssetId: derivedLendingParams.lenderNftAssetId,
        keeperAuthAssetAmount: toUint64(1n),
        withKeeperAssetBurn: true,
        supplierAuthAssetId: derivedLendingParams.borrowerNftAssetId,
        withSupplierAssetBurn: true,
        finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
        isActive: false,
      })
      const finalizedProtocolFeeVaultProgram = loadAssetAuthVaultProgram({
        vaultAssetId: derivedLendingParams.principalAssetId,
        keeperAuthAssetId: protocolFeeKeeperAssetId,
        keeperAuthAssetAmount: toUint64(1n),
        withKeeperAssetBurn: false,
        supplierAuthAssetId: derivedLendingParams.borrowerNftAssetId,
        withSupplierAssetBurn: true,
        finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
        isActive: false,
      })
      const finalizedLenderVaultSpendInfo = buildCovenantSpendInfo(finalizedLenderVaultProgram)
      const finalizedProtocolFeeVaultSpendInfo = buildCovenantSpendInfo(
        finalizedProtocolFeeVaultProgram,
      )

      stage = 'compute repayment amounts'
      const totalFee = totalAmountToRepay - metadata.principalAmount
      const totalProtocolFee = getTotalProtocolFee(totalFee)
      const lenderVaultAmount = totalAmountToRepay - totalProtocolFee

      stage = 'build repayment PSET'
      const burnScript = Script.newOpReturn(BURN_PAYLOAD)
      const walletInputOutpointStrings = [params.principalOutpoint, params.feeOutpoint]
      const inputOrderStrings = [
        params.borrowerNftOutpoint,
        params.activeOfferOutpoint,
        ...walletInputOutpointStrings,
      ]

      let txBuilder = new TxBuilder(lwkNetwork)
        .feeRate(DEFAULT_FEE_RATE)
        .setWalletUtxos(walletInputOutpointStrings.map(o => new OutPoint(o)))
        .setInputOrder(inputOrderStrings.map(o => new OutPoint(o)))
        .addExternalUtxos([
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
            TxOutSecrets.fromExplicit(collateralAsset, collateralAmount),
            LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment,
            true,
          ),
        ])
        .addPostIssuanceScriptOutput(burnScript, NFT_AMOUNT, borrowerNftAsset)
        .addPostIssuanceScriptOutput(
          finalizedLenderVaultSpendInfo.scriptPubkey,
          lenderVaultAmount,
          principalAsset,
        )
        .addPostIssuanceScriptOutput(
          finalizedProtocolFeeVaultSpendInfo.scriptPubkey,
          totalProtocolFee,
          principalAsset,
        )
        .addPostIssuanceRecipient(collateralRecipient, collateralAmount, collateralAsset)

      if (principalChangeAmount > 0n) {
        txBuilder = txBuilder.addPostIssuanceRecipient(
          walletReceiveAddress,
          principalChangeAmount,
          principalAsset,
        )
      }

      const pset = txBuilder.finish(wollet)

      stage = 'sign wallet inputs'
      const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

      const prevouts = [borrowerNftTxOut, activeOfferTxOut, principalTxOut, feeTxOut]

      stage = 'finalize Lending covenant input'
      const finalizedTx = lendingProgram.finalizeTransactionWithSpendInfo(
        txWithWalletWitnesses,
        activeLendingSpendInfo,
        prevouts,
        1, // Lending covenant is at input index 1
        buildLendingWitness({ branch: 'FullRepayment', currentDebt: totalAmountToRepay }),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      stage = 'broadcast transaction'
      const txid = await broadcastTx(finalizedTx.toString())

      return {
        txid,
        // TODO: Remove debug summary before release
        summary: {
          inputs: {
            '0 Borrower NFT': params.borrowerNftOutpoint,
            '1 Active offer Lending': params.activeOfferOutpoint,
            '2 Principal wallet UTXO': params.principalOutpoint,
            '3 Fee L-BTC': params.feeOutpoint,
          },
          outputs: {
            '0 Borrower NFT burn': bytesToHex(burnScript.bytes()),
            '1 Finalized lender vault': bytesToHex(
              finalizedLenderVaultSpendInfo.scriptPubkey.bytes(),
            ),
            '2 Finalized protocol fee vault': bytesToHex(
              finalizedProtocolFeeVaultSpendInfo.scriptPubkey.bytes(),
            ),
            '3 Unlocked collateral': collateralRecipient.toString(),
            'Principal change':
              principalChangeAmount > 0n
                ? `${principalChangeAmount.toString()} to ${walletReceiveAddress.toString()}`
                : 'None',
            'L-BTC change': 'Managed by LWK after covenant outputs',
          },
          assetIds: {
            collateralAssetId: collateralAsset.toString(),
            principalAssetId: principalAsset.toString(),
            borrowerNftAssetId: borrowerNftAsset.toString(),
            lenderNftAssetId: lenderNftAsset.toString(),
          },
          amounts: {
            collateralAmount: collateralAmount.toString(),
            totalAmountToRepay: totalAmountToRepay.toString(),
            totalFee: totalFee.toString(),
            totalProtocolFee: totalProtocolFee.toString(),
            lenderVaultAmount: lenderVaultAmount.toString(),
            principalInputAmount: principalInputAmount.toString(),
            principalChangeAmount: principalChangeAmount.toString(),
          },
        },
      }
    } catch (err) {
      throw wrapErrorWithContext(err, stage)
    }
  }

  return { repayOffer }
}
