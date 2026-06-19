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
import { fetchFeeRateSatPerKvb } from '@/lwk/fee'
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
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  isPolicyAssetUtxo,
  requireWalletUtxo,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  LENDING_MAX_WEIGHT_TO_SATISFY,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { wrapErrorWithContext } from '@/utils/errorHandler'
import { bytesToHex } from '@/utils/hex'
import { toBytes32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const MAX_SEQUENCE_NON_RBF = 0xfffffffe
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface LiquidateOfferParams {
  activeOfferOutpoint: string
  createOfferTxid: string
  lenderNftOutpoint: string
  feeOutpoint: string
}

export interface LiquidateOfferResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
    offerParameters: Record<string, string>
  }
}

export function useLiquidateOffer() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const liquidateOffer = async (params: LiquidateOfferParams): Promise<LiquidateOfferResult> => {
    let stage = 'initializing'

    try {
      stage = 'parse input outpoints'
      const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
      const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
      const feeOutpoint = new OutPoint(params.feeOutpoint)
      assertDistinctOutpoints(
        [activeOfferOutpoint, lenderNftOutpoint, feeOutpoint],
        'Liquidation inputs must use three distinct outpoints',
      )

      stage = 'load wallet context'
      const [receiveAddressString, wollet, feeRate] = await Promise.all([
        getReceiveAddress(),
        getWollet(),
        fetchFeeRateSatPerKvb(),
      ])
      if (!receiveAddressString) throw new Error('Missing receive address')
      const collateralRecipient = Address.parse(receiveAddressString, lwkNetwork)

      stage = 'sync wallet and verify wallet inputs'
      await syncWallet()
      const blindedWalletUtxos = await getBlindedWalletUtxos()
      const feeUtxo = requireWalletUtxo(blindedWalletUtxos, params.feeOutpoint, 'Fee L-BTC')
      if (!isPolicyAssetUtxo(feeUtxo, lwkNetwork.policyAsset())) {
        throw new Error('Fee outpoint must be a wallet L-BTC UTXO')
      }

      stage = 'load input transactions'
      // TODO: Handle with indexer
      // create-offer tx vout 2 = Borrower NFT (asset id needed for program reconstruction)
      const borrowerNftReferenceOutpoint = new OutPoint(`${params.createOfferTxid}:2`)
      const [activeOfferTx, createOfferTx, borrowerNftTx, lenderNftTx, feeTx] = await Promise.all([
        fetchTransaction(activeOfferOutpoint),
        fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
        fetchTransaction(borrowerNftReferenceOutpoint),
        fetchTransaction(lenderNftOutpoint),
        fetchTransaction(feeOutpoint),
      ])
      const activeOfferTxOut = requireTxOut(
        activeOfferTx,
        activeOfferOutpoint.vout(),
        'Active offer',
      )
      const borrowerNftTxOut = requireTxOut(
        borrowerNftTx,
        borrowerNftReferenceOutpoint.vout(),
        'Borrower NFT reference',
      )
      const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
      const feeTxOut = requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC')

      const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
      const collateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
      const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT reference')
      const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
      assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')

      stage = 'recover create-offer parameters'
      const metadata = await findPendingOfferMetadata(createOfferTx)

      stage = 'compile active Lending program'
      const offerParameters = {
        collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
        principalAmount: metadata.principalAmount,
        principalInterestRate: metadata.principalInterestRate,
        loanExpirationTime: metadata.loanExpirationTime,
      }
      const derivedLendingParams = buildDerivedLendingOfferProgramParams({
        collateralAssetId: toBytes32(collateralAsset.toBytes(), 'collateralAssetId'),
        principalAssetId: metadata.principalAssetId,
        borrowerNftAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
        lenderNftAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
        protocolFeeKeeperAssetId: toBytes32(
          AssetId.fromString(NETWORK_CONFIG.protocolFeeAsset.id).toBytes(),
          'protocolFeeKeeperAssetId',
        ),
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

      const currentDebt = getTotalAmountToRepay(offerParameters)

      stage = 'build liquidation PSET'
      const burnScript = Script.newOpReturn(BURN_PAYLOAD)

      const pset = new TxBuilder(lwkNetwork)
        .feeRate(feeRate)
        .setWalletUtxos([new OutPoint(params.feeOutpoint)])
        .setInputOrder([
          new OutPoint(params.activeOfferOutpoint),
          new OutPoint(params.lenderNftOutpoint),
          new OutPoint(params.feeOutpoint),
        ])
        .addExternalUtxos([
          new ExternalUtxo(
            activeOfferOutpoint.vout(),
            activeOfferTx,
            TxOutSecrets.fromExplicit(collateralAsset, collateralAmount),
            LENDING_MAX_WEIGHT_TO_SATISFY.Liquidation,
            true,
          ),
          new ExternalUtxo(
            lenderNftOutpoint.vout(),
            lenderNftTx,
            TxOutSecrets.fromExplicit(lenderNftAsset, NFT_AMOUNT),
            EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
        ])
        .addPostIssuanceScriptOutput(burnScript, NFT_AMOUNT, lenderNftAsset)
        .addPostIssuanceRecipient(collateralRecipient, collateralAmount, collateralAsset)
        .setFallbackLocktimeHeight(metadata.loanExpirationTime)
        .setInputSequence(new OutPoint(params.activeOfferOutpoint), MAX_SEQUENCE_NON_RBF)
        .finish(wollet)

      stage = 'sign wallet inputs'
      const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

      const prevouts = [activeOfferTxOut, lenderNftTxOut, feeTxOut]

      stage = 'finalize active Lending covenant input'
      const finalizedTx = lendingProgram.finalizeTransactionWithSpendInfo(
        txWithWalletWitnesses,
        activeLendingSpendInfo,
        prevouts,
        0,
        buildLendingWitness({ branch: 'Liquidation', currentDebt }),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      stage = 'broadcast transaction'
      const txid = await broadcastTx(finalizedTx.toString())

      // TODO: Remove debug summary before release
      return {
        txid,
        summary: {
          inputs: {
            '0 Active offer Lending': params.activeOfferOutpoint,
            '1 Lender NFT (wallet)': params.lenderNftOutpoint,
            '2 Fee L-BTC': params.feeOutpoint,
            'Create-offer tx (metadata)': params.createOfferTxid,
          },
          outputs: {
            '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
            '1 Unlocked collateral': collateralRecipient.toString(),
            'L-BTC change': 'Managed by LWK',
          },
          assetIds: {
            collateralAssetId: collateralAsset.toString(),
            principalAssetId: AssetId.fromBytes(metadata.principalAssetId).toString(),
            borrowerNftAssetId: borrowerNftAsset.toString(),
            lenderNftAssetId: lenderNftAsset.toString(),
          },
          offerParameters: {
            collateralAmount: collateralAmount.toString(),
            principalAmount: metadata.principalAmount.toString(),
            principalInterestRate: metadata.principalInterestRate.toString(),
            loanExpirationTime: metadata.loanExpirationTime.toString(),
            currentDebt: currentDebt.toString(),
          },
        },
      }
    } catch (err) {
      throw wrapErrorWithContext(err, stage)
    }
  }

  return { liquidateOffer }
}
