import {
  Address,
  AssetId,
  OutPoint,
  type Pset,
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
import { isPolicyAssetUtxo, requireWalletUtxo, WALLET_INPUT_RBF_SEQUENCE } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadAssetAuthProgram } from '@/simplicity/asset-auth/program'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  LENDING_MAX_WEIGHT_TO_SATISFY,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import {
  buildScriptAuthWitness,
  loadScriptAuthProgram,
  SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
} from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n

export interface AcceptOfferParams {
  pendingOfferOutpoint: string
  lenderNftOutpoint: string
  borrowerNftReferenceOutpoint: string
  principalOutpoints: string[]
  feeOutpoints: string[]
  lenderNftRecipientAddress?: string
}

export interface AcceptOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  offerParameters: Record<string, string>
  scripts: Record<string, string>
}

export function useAcceptOffer() {
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

  const acceptOffer = async (
    params: AcceptOfferParams,
  ): Promise<UpdatedPset<AcceptOfferSummary>> => {
    const pendingOfferOutpoint = new OutPoint(params.pendingOfferOutpoint)
    const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
    const borrowerNftReferenceOutpoint = new OutPoint(params.borrowerNftReferenceOutpoint)
    const principalOutpoints = params.principalOutpoints.map(o => new OutPoint(o))
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [
        pendingOfferOutpoint,
        lenderNftOutpoint,
        borrowerNftReferenceOutpoint,
        ...principalOutpoints,
        ...feeOutpoints,
      ],
      'Acceptance outpoints must be distinct',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing receive address')
    const lenderNftRecipient = Address.parse(
      params.lenderNftRecipientAddress?.trim() || receiveAddressString,
      lwkNetwork,
    ).toUnconfidential()
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const principalUtxos = params.principalOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, 'Principal'),
    )
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    const [pendingOfferTx, lenderNftTx, borrowerNftTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(pendingOfferOutpoint),
      fetchTransaction(lenderNftOutpoint),
      fetchTransaction(borrowerNftReferenceOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    const pendingOfferTxOut = requireTxOut(
      pendingOfferTx,
      pendingOfferOutpoint.vout(),
      'Pending offer',
    )
    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const borrowerNftTxOut = requireTxOut(
      borrowerNftTx,
      borrowerNftReferenceOutpoint.vout(),
      'Borrower NFT reference',
    )
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const collateralAsset = requireExplicitAsset(pendingOfferTxOut, 'Pending offer')
    const collateralAmount = requireExplicitAmount(pendingOfferTxOut, 'Pending offer')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT reference')
    assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT reference')
    const metadata = await findPendingOfferMetadata(pendingOfferTx)
    const principalAsset = AssetId.fromBytes(metadata.principalAssetId)
    for (const principalUtxo of principalUtxos) {
      const actualAssetId = principalUtxo.unblinded().asset().toString()
      if (actualAssetId !== principalAsset.toString()) {
        throw new Error(`Principal UTXO has unexpected asset ${actualAssetId}`)
      }
    }
    const principalInputAmount = principalUtxos.reduce(
      (sum, utxo) => sum + utxo.unblinded().value(),
      0n,
    )
    if (principalInputAmount < metadata.principalAmount) {
      throw new Error(`Principal UTXO amount is lower than ${metadata.principalAmount.toString()}`)
    }
    const principalChangeAmount = principalInputAmount - metadata.principalAmount
    assertDistinctOutpoints(
      [pendingOfferOutpoint, lenderNftOutpoint, ...principalOutpoints, ...feeOutpoints],
      'Acceptance inputs must use distinct outpoints',
    )
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
    const pendingLendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, offerParameters)
    const activeLendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, offerParameters, true)

    assertScriptMatches(
      pendingOfferTxOut.scriptPubkey(),
      pendingLendingSpendInfo.scriptPubkey,
      'Pending offer output does not match the reconstructed pending Lending covenant',
    )

    const pendingLendingScriptHash = toBytes32(
      hexToBytes(pendingLendingSpendInfo.scriptPubkey.jet_sha256_hex()),
      'pendingLendingScriptHash',
    )
    const scriptAuthProgram = loadScriptAuthProgram(pendingLendingScriptHash)
    const scriptAuthSpendInfo = buildCovenantSpendInfo(scriptAuthProgram)
    assertScriptMatches(
      lenderNftTxOut.scriptPubkey(),
      scriptAuthSpendInfo.scriptPubkey,
      'Lender NFT output is not locked by this pending offer ScriptAuth covenant',
    )

    const totalAmountToRepay = getTotalAmountToRepay(offerParameters)
    const principalOutputAssetAuthProgram = loadAssetAuthProgram({
      assetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      assetAmount: toUint64(NFT_AMOUNT, 'borrowerNftAmount'),
      withAssetBurn: false,
    })
    const principalOutputSpendInfo = buildCovenantSpendInfo(principalOutputAssetAuthProgram)
    const principalTransactions = await Promise.all(
      principalOutpoints.map(outpoint => fetchTransaction(outpoint)),
    )
    const principalTxOuts = principalTransactions.map((tx, index) =>
      requireTxOut(tx, principalOutpoints[index].vout(), 'Principal input'),
    )
    if (principalUtxos.length + feeUtxos.length === 0) {
      throw new Error('At least one wallet UTXO is required')
    }
    const blinding: PsetBlinding = signerType === 'humid' ? 'wallet' : 'local'
    const walletInputs = [
      ...principalUtxos.map((utxo, index) => ({
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
          outpoint: pendingOfferOutpoint,
          prevout: pendingOfferTxOut,
          asset: collateralAsset,
          amount: collateralAmount,
          maxWeightToSatisfy: LENDING_MAX_WEIGHT_TO_SATISFY.OfferAcceptance,
        },
        {
          outpoint: lenderNftOutpoint,
          prevout: lenderNftTxOut,
          asset: lenderNftAsset,
          amount: NFT_AMOUNT,
          maxWeightToSatisfy: SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
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
        {
          script: activeLendingSpendInfo.scriptPubkey,
          amount: collateralAmount,
          asset: collateralAsset,
        },
        {
          script: principalOutputSpendInfo.scriptPubkey,
          amount: metadata.principalAmount,
          asset: principalAsset,
        },
        { script: lenderNftRecipient.scriptPubkey(), amount: NFT_AMOUNT, asset: lenderNftAsset },
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

        const prevouts = [pendingOfferTxOut, lenderNftTxOut, ...principalTxOuts, ...feeTxOuts]
        const txWithLendingWitness = lendingProgram.finalizeTransaction(
          txWithWalletWitnesses,
          pendingLendingSpendInfo.controlBlock(lendingProgram.cmr),
          prevouts,
          0,
          buildLendingWitness({ branch: 'OfferAcceptance' }),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        const scriptAuthPrevouts = [
          requireTxOut(pendingOfferTx, pendingOfferOutpoint.vout(), 'Pending offer'),
          requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT'),
          ...principalTransactions.map((tx, index) =>
            requireTxOut(tx, principalOutpoints[index].vout(), 'Principal input'),
          ),
          ...feeTxs.map((tx, index) =>
            requireTxOut(
              tx,
              feeOutpoints[index].vout(),
              `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`,
            ),
          ),
        ]
        const finalizedTx = scriptAuthProgram.finalizeTransaction(
          txWithLendingWitness,
          scriptAuthSpendInfo.controlBlock(scriptAuthProgram.cmr),
          scriptAuthPrevouts,
          1,
          buildScriptAuthWitness(toUint32(0, 'lendingInputIndex')),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        return {
          finalizedTx,
          // TODO: Remove debug summary before release
          summary: {
            inputs: {
              '0 Pending offer Lending': params.pendingOfferOutpoint,
              '1 Lender NFT ScriptAuth': params.lenderNftOutpoint,
              '2+ Principal wallet UTXO(s)': params.principalOutpoints.join(', '),
              [`Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
                params.feeOutpoints.join(', '),
              'Reference Borrower NFT': params.borrowerNftReferenceOutpoint,
            },
            outputs: {
              '0 Active offer Lending': bytesToHex(activeLendingSpendInfo.scriptPubkey.bytes()),
              '1 Borrower principal AssetAuth': bytesToHex(
                principalOutputSpendInfo.scriptPubkey.bytes(),
              ),
              '2 Lender NFT recipient': lenderNftRecipient.toString(),
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
            offerParameters: {
              collateralAmount: collateralAmount.toString(),
              principalAmount: metadata.principalAmount.toString(),
              principalInputAmount: principalInputAmount.toString(),
              principalInterestRate: metadata.principalInterestRate.toString(),
              totalAmountToRepay: totalAmountToRepay.toString(),
              loanExpirationTime: metadata.loanExpirationTime.toString(),
            },
            scripts: {
              pendingLendingScriptHash: bytesToHex(pendingLendingScriptHash),
              activeLendingScript: bytesToHex(activeLendingSpendInfo.scriptPubkey.bytes()),
              principalOutputScriptHash: bytesToHex(derivedLendingParams.principalOutputScriptHash),
            },
          },
        }
      },
    }
  }

  return { acceptOffer }
}
