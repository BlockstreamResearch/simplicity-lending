import {
  Address,
  AssetId,
  OutPoint,
  type Pset,
  Script,
  SimplicityLogLevel,
  type TxOutSecrets,
} from 'lwk_wasm'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { buildPset, type PsetBlinding } from '@/lwk/psetBuilder'
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
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const MAX_SEQUENCE_NON_RBF = 0xfffffffe
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface LiquidateOfferParams {
  activeOfferOutpoint: string
  createOfferTxid: string
  lenderNftOutpoint: string
  currentDebt?: string
  feeOutpoints: string[]
}

export interface LiquidateOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  offerParameters: Record<string, string>
}

export function useLiquidateOffer() {
  const { lwkNetwork } = useLwk()
  const {
    getReceiveAddress,
    getChangeAddress,
    getBlindedWalletUtxos,
    getWollet,
    syncWallet,
    signerType,
  } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const liquidateOffer = async (
    params: LiquidateOfferParams,
  ): Promise<UpdatedPset<LiquidateOfferSummary>> => {
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
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    if (!receiveAddressString) throw new Error('Missing receive address')
    const collateralRecipient = Address.parse(receiveAddressString, lwkNetwork)
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    // TODO: Handle with indexer
    const [activeOfferTx, createOfferTx, lenderNftTx, feeTxs] = await Promise.all([
      fetchTransaction(activeOfferOutpoint),
      fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
      fetchTransaction(lenderNftOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
    ])
    const activeOfferTxOut = requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer')
    // create-offer tx vout 2 = Borrower NFT (asset id needed for program reconstruction) —
    // fetched once above via createOfferTx, reused here instead of a second round trip.
    const borrowerNftTxOut = requireTxOut(createOfferTx, 2, 'Borrower NFT reference')
    // create-offer tx vout 5 = pending offer Lending covenant, which still carries the original
    // (compile-time) collateral amount. activeOfferTxOut's amount already shrinks after a prior
    // partial repayment, so it can't be reused as the covenant-reconstruction argument once this
    // isn't the offer's first touch — same distinction usePartialRepayOffer draws.
    const pendingOfferTxOut = requireTxOut(createOfferTx, 5, 'Pending offer Lending')
    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
    const currentCollateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
    const originalCollateralAmount = requireExplicitAmount(
      pendingOfferTxOut,
      'Pending offer Lending',
    )
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT reference')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
    assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')
    const metadata = await findPendingOfferMetadata(createOfferTx)
    const offerParameters = {
      collateralAmount: toUint64(originalCollateralAmount, 'collateralAmount'),
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
    const currentDebt = params.currentDebt?.trim()
      ? toUint64(BigInt(params.currentDebt.trim()), 'currentDebt')
      : getTotalAmountToRepay(offerParameters)
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

    const burnScript = Script.newOpReturn(BURN_PAYLOAD)
    if (params.feeOutpoints.length === 0) throw new Error('At least one fee UTXO is required')

    const blinding: PsetBlinding = signerType === 'humid' ? 'wallet' : 'local'

    const changeAddress = await getChangeAddress()
    const { pset } = buildPset({
      network: lwkNetwork,
      inputs: [
        {
          outpoint: activeOfferOutpoint,
          prevout: activeOfferTxOut,
          asset: collateralAsset,
          amount: currentCollateralAmount,
          // Non-final, so the covenant's locktime is enforced.
          sequence: MAX_SEQUENCE_NON_RBF,
          maxWeightToSatisfy: LENDING_MAX_WEIGHT_TO_SATISFY.Liquidation,
        },
        {
          outpoint: lenderNftOutpoint,
          prevout: lenderNftTxOut,
          asset: lenderNftAsset,
          amount: NFT_AMOUNT,
          maxWeightToSatisfy: EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        },
        ...feeUtxos.map((utxo, index) => ({
          outpoint: feeOutpoints[index],
          prevout: feeTxOuts[index],
          asset: utxo.unblinded().asset(),
          amount: utxo.unblinded().value(),
          secrets: blinding === 'local' ? (utxo.unblinded() as TxOutSecrets) : undefined,
          walletCoin: true,
          // One RBF-signaling input is enough to make the whole tx replaceable (BIP-125 rule 1).
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
          maxWeightToSatisfy: wollet.maxWeightToSatisfy(),
        })),
      ],
      outputs: [
        { script: burnScript, amount: NFT_AMOUNT, asset: lenderNftAsset },
        {
          script: collateralRecipient.scriptPubkey(),
          amount: currentCollateralAmount,
          asset: collateralAsset,
          blindingPubkey: collateralRecipient.blindingPubkey(),
        },
      ],
      changeAddress,
      feeRateSatPerKvb: feeRate,
      fallbackLocktime: metadata.loanExpirationTime,
      blinding,
    })
    pset.addDetails(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const txWithWalletWitnesses = wollet.finalize(signedPset).extractTx()

        const prevouts = [activeOfferTxOut, lenderNftTxOut, ...feeTxOuts]
        const finalizedTx = lendingProgram.finalizeTransaction(
          txWithWalletWitnesses,
          activeLendingSpendInfo.controlBlock(lendingProgram.cmr),
          prevouts,
          0,
          buildLendingWitness({ branch: 'Liquidation', currentDebt }),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        // TODO: Remove debug summary before release
        return {
          finalizedTx,
          summary: {
            inputs: {
              '0 Active offer Lending': params.activeOfferOutpoint,
              '1 Lender NFT (wallet)': params.lenderNftOutpoint,
              [`2+ Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
                params.feeOutpoints.join(', '),
              'Create-offer tx (metadata)': params.createOfferTxid,
            },
            outputs: {
              '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
              '1 Unlocked collateral': collateralRecipient.toString(),
              [`${NETWORK_CONFIG.collateralAsset.symbol} change`]: changeAddress.toString(),
            },
            assetIds: {
              collateralAssetId: collateralAsset.toString(),
              principalAssetId: AssetId.fromBytes(metadata.principalAssetId).toString(),
              borrowerNftAssetId: borrowerNftAsset.toString(),
              lenderNftAssetId: lenderNftAsset.toString(),
            },
            offerParameters: {
              collateralAmount: originalCollateralAmount.toString(),
              currentCollateralAmount: currentCollateralAmount.toString(),
              principalAmount: metadata.principalAmount.toString(),
              principalInterestRate: metadata.principalInterestRate.toString(),
              loanExpirationTime: metadata.loanExpirationTime.toString(),
              currentDebt: currentDebt.toString(),
            },
          },
        }
      },
    }
  }

  return { liquidateOffer }
}
