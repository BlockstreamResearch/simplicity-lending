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

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
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
import { bytesToHex } from '@/utils/hex'
import { toBytes32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const MAX_SEQUENCE_NON_RBF = 0xfffffffe
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface LiquidateOfferParams {
  activeOfferOutpoint: string
  createOfferTxid: string
  lenderNftOutpoint: string
  feeOutpoints: string[]
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
    const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
    const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [activeOfferOutpoint, lenderNftOutpoint, ...feeOutpoints],
      'Liquidation inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet, feeRate] = await Promise.all([
      getReceiveAddress(),
      getWollet(),
      fetchFeeRateSatPerKvb(),
    ])
    if (!receiveAddressString) throw new Error('Missing receive address')
    const collateralRecipient = Address.parse(receiveAddressString, lwkNetwork)
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, 'Fee L-BTC'),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error('Fee outpoints must be wallet L-BTC UTXOs')
    }
    // TODO: Handle with indexer
    // create-offer tx vout 2 = Borrower NFT (asset id needed for program reconstruction)
    const borrowerNftReferenceOutpoint = new OutPoint(`${params.createOfferTxid}:2`)
    const [activeOfferTx, createOfferTx, borrowerNftTx, lenderNftTx, feeTxs] = await Promise.all([
      fetchTransaction(activeOfferOutpoint),
      fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
      fetchTransaction(borrowerNftReferenceOutpoint),
      fetchTransaction(lenderNftOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
    ])
    const activeOfferTxOut = requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer')
    const borrowerNftTxOut = requireTxOut(
      borrowerNftTx,
      borrowerNftReferenceOutpoint.vout(),
      'Borrower NFT reference',
    )
    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC'),
    )

    const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
    const collateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT reference')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
    assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')
    const metadata = await findPendingOfferMetadata(createOfferTx)
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
    const activeLendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, offerParameters, true)

    assertScriptMatches(
      activeOfferTxOut.scriptPubkey(),
      activeLendingSpendInfo.scriptPubkey,
      'Active offer output does not match the reconstructed active Lending covenant',
    )

    const currentDebt = getTotalAmountToRepay(offerParameters)
    const burnScript = Script.newOpReturn(BURN_PAYLOAD)

    const pset = new TxBuilder(lwkNetwork)
      .feeRate(feeRate)
      .setWalletUtxos(params.feeOutpoints.map(o => new OutPoint(o)))
      .setInputOrder([
        new OutPoint(params.activeOfferOutpoint),
        new OutPoint(params.lenderNftOutpoint),
        ...params.feeOutpoints.map(o => new OutPoint(o)),
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
    const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

    const prevouts = [activeOfferTxOut, lenderNftTxOut, ...feeTxOuts]
    const finalizedTx = lendingProgram.finalizeTransactionWithSpendInfo(
      txWithWalletWitnesses,
      activeLendingSpendInfo,
      prevouts,
      0,
      buildLendingWitness({ branch: 'Liquidation', currentDebt }),
      lwkNetwork,
      SimplicityLogLevel.Trace,
    )
    const txid = await broadcastTx(finalizedTx.toString())

    // TODO: Remove debug summary before release
    return {
      txid,
      summary: {
        inputs: {
          '0 Active offer Lending': params.activeOfferOutpoint,
          '1 Lender NFT (wallet)': params.lenderNftOutpoint,
          '2+ Fee L-BTC (wallet)': params.feeOutpoints.join(', '),
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
  }

  return { liquidateOffer }
}
