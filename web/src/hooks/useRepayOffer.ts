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
import { BPS_DIVISOR } from '@/constants/offers'
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
import { bytesToHex } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const BURN_PAYLOAD = new TextEncoder().encode('burn')

// 10% of the total fee goes to the protocol, matching PROTOCOL_FEE_PERCENTAGE in Rust.
// Check crates/contracts/src/programs/lending/offer.rs)
const PROTOCOL_FEE_BPS = 1_000n

function getTotalProtocolFee(totalFee: bigint): bigint {
  return (totalFee * PROTOCOL_FEE_BPS) / BPS_DIVISOR
}

export interface RepayOfferParams {
  activeOfferOutpoint: string
  borrowerNftOutpoint: string
  principalOutpoints: string[]
  feeOutpoints: string[]
  collateralRecipientAddress?: string
}

export interface RepayOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
}

export function useRepayOffer() {
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

  const repayOffer = async (params: RepayOfferParams): Promise<UpdatedPset<RepayOfferSummary>> => {
    const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
    const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
    const principalOutpoints = params.principalOutpoints.map(o => new OutPoint(o))
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [activeOfferOutpoint, borrowerNftOutpoint, ...principalOutpoints, ...feeOutpoints],
      'Repayment inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const collateralRecipient = Address.parse(
      params.collateralRecipientAddress?.trim() || receiveAddressString,
      lwkNetwork,
    )
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    const principalWalletUtxos = params.principalOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, 'Principal'),
    )
    const [activeOfferTx, borrowerNftTx] = await Promise.all([
      fetchTransaction(activeOfferOutpoint),
      fetchTransaction(borrowerNftOutpoint),
    ])
    const pendingOfferOutpoint = activeOfferTx.inputs[0].outpoint()
    const [pendingOfferTx, principalTxs, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(pendingOfferOutpoint),
      Promise.all(principalOutpoints.map(o => fetchTransaction(o))),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    const activeOfferTxOut = requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer')
    const borrowerNftTxOut = requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT')
    const lenderNftTxOut = requireTxOut(activeOfferTx, 2, 'Lender NFT reference')
    const principalTxOuts = principalTxs.map((tx, index) =>
      requireTxOut(tx, principalOutpoints[index].vout(), 'Principal'),
    )
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
    const collateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT reference')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')
    const metadata = await findPendingOfferMetadata(pendingOfferTx)
    const principalAsset = AssetId.fromBytes(metadata.principalAssetId)
    const offerParameters = {
      collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
      loanExpirationTime: metadata.loanExpirationTime,
    }
    const totalAmountToRepay = getTotalAmountToRepay(offerParameters)
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
    if (principalInputAmount < totalAmountToRepay) {
      throw new Error(`Principal UTXO amount is lower than ${totalAmountToRepay.toString()}`)
    }
    const principalChangeAmount = principalInputAmount - totalAmountToRepay
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
    const activeLendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, offerParameters, true)

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
    const totalFee = totalAmountToRepay - metadata.principalAmount
    const totalProtocolFee = getTotalProtocolFee(totalFee)
    const lenderVaultAmount = totalAmountToRepay - totalProtocolFee
    const burnScript = Script.newOpReturn(BURN_PAYLOAD)
    if (principalWalletUtxos.length + feeUtxos.length === 0) {
      throw new Error('At least one wallet UTXO is required')
    }
    const blinding: PsetBlinding = signerType === 'humid' ? 'wallet' : 'local'
    const walletInputs = [
      ...principalWalletUtxos.map((utxo, index) => ({
        utxo,
        outpoint: principalOutpoints[index],
        prevout: principalTxOuts[index],
      })),
      ...feeUtxos.map((utxo, index) => ({
        utxo,
        outpoint: feeOutpoints[index],
        prevout: feeTxOuts[index],
      })),
    ]

    const changeAddress = await getChangeAddress()
    const { pset } = buildPset({
      network: lwkNetwork,
      inputs: [
        {
          outpoint: borrowerNftOutpoint,
          prevout: borrowerNftTxOut,
          asset: borrowerNftAsset,
          amount: NFT_AMOUNT,
          maxWeightToSatisfy: EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        },
        {
          outpoint: activeOfferOutpoint,
          prevout: activeOfferTxOut,
          asset: collateralAsset,
          amount: collateralAmount,
          maxWeightToSatisfy: LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment,
        },
        ...walletInputs.map(({ utxo, outpoint, prevout }, index) => ({
          outpoint,
          prevout,
          asset: utxo.unblinded().asset(),
          amount: utxo.unblinded().value(),
          secrets: blinding === 'local' ? (utxo.unblinded() as TxOutSecrets) : undefined,
          walletCoin: true,
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
          maxWeightToSatisfy: wollet.maxWeightToSatisfy(),
        })),
      ],
      outputs: [
        { script: burnScript, amount: NFT_AMOUNT, asset: borrowerNftAsset },
        {
          script: finalizedLenderVaultSpendInfo.scriptPubkey,
          amount: lenderVaultAmount,
          asset: principalAsset,
        },
        {
          script: finalizedProtocolFeeVaultSpendInfo.scriptPubkey,
          amount: totalProtocolFee,
          asset: principalAsset,
        },
        {
          script: collateralRecipient.scriptPubkey(),
          amount: collateralAmount,
          asset: collateralAsset,
          blindingPubkey: collateralRecipient.blindingPubkey(),
        },
        ...(principalChangeAmount > 0n
          ? [
              {
                script: changeAddress.scriptPubkey(),
                amount: principalChangeAmount,
                asset: principalAsset,
                blindingPubkey: changeAddress.blindingPubkey(),
              },
            ]
          : []),
      ],
      changeAddress,
      feeRateSatPerKvb: feeRate,
      blinding,
    })
    pset.addDetails(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const txWithWalletWitnesses = wollet.finalize(signedPset).extractTx()

        const prevouts = [borrowerNftTxOut, activeOfferTxOut, ...principalTxOuts, ...feeTxOuts]
        const finalizedTx = lendingProgram.finalizeTransaction(
          txWithWalletWitnesses,
          activeLendingSpendInfo.controlBlock(lendingProgram.cmr),
          prevouts,
          1, // Lending covenant is at input index 1
          buildLendingWitness({ branch: 'FullRepayment', currentDebt: totalAmountToRepay }),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        return {
          finalizedTx,
          // TODO: Remove debug summary before release
          summary: {
            inputs: {
              '0 Borrower NFT': params.borrowerNftOutpoint,
              '1 Active offer Lending': params.activeOfferOutpoint,
              '2+ Principal wallet UTXO(s)': params.principalOutpoints.join(', '),
              [`Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
                params.feeOutpoints.join(', '),
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
                  ? `${principalChangeAmount.toString()} to ${changeAddress.toString()}`
                  : 'None',
              [`${NETWORK_CONFIG.collateralAsset.symbol} change`]:
                'Managed by LWK after covenant outputs',
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
      },
    }
  }

  return { repayOffer }
}
