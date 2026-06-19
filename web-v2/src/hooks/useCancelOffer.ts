import {
  Address,
  AssetId,
  ExternalUtxo,
  OutPoint,
  Script,
  SimplicityLogLevel,
  TxBuilder,
  TxOutSecrets,
  XOnlyPublicKey,
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
import {
  buildScriptAuthWitness,
  loadScriptAuthProgram,
  SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
} from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo, UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { wrapErrorWithContext } from '@/utils/errorHandler'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface CancelOfferParams {
  pendingOfferOutpoint: string
  lenderNftOutpoint: string
  borrowerNftOutpoint: string
  collateralRecipientAddress: string
  feeOutpoints: string[]
}

export interface CancelOfferResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
  }
}

export function useCancelOffer() {
  const { lwkNetwork } = useLwk()
  const { getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const cancelOffer = async (params: CancelOfferParams): Promise<CancelOfferResult> => {
    let stage = 'initializing'

    try {
      stage = 'parse input outpoints'
      const pendingOfferOutpoint = new OutPoint(params.pendingOfferOutpoint)
      const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
      const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
      const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
      assertDistinctOutpoints(
        [pendingOfferOutpoint, lenderNftOutpoint, borrowerNftOutpoint, ...feeOutpoints],
        'Cancellation inputs must use distinct outpoints',
      )

      stage = 'load wallet context'
      const wollet = await getWollet()

      stage = 'sync wallet and verify fee input'
      await syncWallet()
      const blindedWalletUtxos = await getBlindedWalletUtxos()
      const feeUtxos = params.feeOutpoints.map(o =>
        requireWalletUtxo(blindedWalletUtxos, o, 'Fee L-BTC'),
      )
      if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
        throw new Error('Fee outpoints must be wallet L-BTC UTXOs')
      }

      stage = 'load input transactions'
      const [pendingOfferTx, lenderNftTx, borrowerNftTx, feeTxs, feeRate] = await Promise.all([
        fetchTransaction(pendingOfferOutpoint),
        fetchTransaction(lenderNftOutpoint),
        fetchTransaction(borrowerNftOutpoint),
        Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
        fetchFeeRateSatPerKvb(),
      ])
      const pendingOfferTxOut = requireTxOut(
        pendingOfferTx,
        pendingOfferOutpoint.vout(),
        'Pending offer',
      )

      const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
      const borrowerNftTxOut = requireTxOut(
        borrowerNftTx,
        borrowerNftOutpoint.vout(),
        'Borrower NFT',
      )
      const feeTxOuts = feeTxs.map((tx, index) =>
        requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC'),
      )

      const collateralAsset = requireExplicitAsset(pendingOfferTxOut, 'Pending offer')
      const collateralAmount = requireExplicitAmount(pendingOfferTxOut, 'Pending offer')
      const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
      assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')

      const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
      assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')

      stage = 'recover pending offer parameters'
      const metadata = await findPendingOfferMetadata(pendingOfferTx)

      stage = 'compile Lending and ScriptAuth programs'
      const protocolFeeKeeperAssetId = toBytes32(
        AssetId.fromString(NETWORK_CONFIG.protocolFeeAsset.id).toBytes(),
        'protocolFeeKeeperAssetId',
      )
      // TODO: Indexer will handle this
      const derivedLendingParams = buildDerivedLendingOfferProgramParams({
        collateralAssetId: toBytes32(collateralAsset.toBytes(), 'collateralAssetId'),
        principalAssetId: metadata.principalAssetId,
        borrowerNftAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
        lenderNftAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
        protocolFeeKeeperAssetId,
        offerParameters: {
          collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
          principalAmount: metadata.principalAmount,
          principalInterestRate: metadata.principalInterestRate,
          loanExpirationTime: metadata.loanExpirationTime,
        },
      })
      const lendingProgram = loadLendingProgram(derivedLendingParams)
      // TODO: Probably we will be able to obtain this info from
      // the indexer in the future, so we won't need to reconstruct the spend info on the client side
      const lendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, {
        principalAmount: metadata.principalAmount,
        principalInterestRate: metadata.principalInterestRate,
      })

      assertScriptMatches(
        pendingOfferTxOut.scriptPubkey(),
        lendingSpendInfo.scriptPubkey,
        'Pending offer output does not match the reconstructed Lending covenant',
      )

      const lendingScriptHash = toBytes32(
        hexToBytes(lendingSpendInfo.scriptPubkey.jet_sha256_hex()),
        'lendingScriptHash',
      )
      const scriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
      const scriptAuthAddress = scriptAuthProgram.createP2trAddress(
        XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
        lwkNetwork,
      )
      assertScriptMatches(
        lenderNftTxOut.scriptPubkey(),
        scriptAuthAddress.scriptPubkey(),
        'Lender NFT output is not locked by this pending offer ScriptAuth covenant',
      )

      stage = 'build cancellation PSET'
      const burnScript = Script.newOpReturn(BURN_PAYLOAD)
      const collateralRecipient = Address.parse(params.collateralRecipientAddress, lwkNetwork)
      const pendingOfferVout = pendingOfferOutpoint.vout()
      const lenderNftVout = lenderNftOutpoint.vout()
      const borrowerNftVout = borrowerNftOutpoint.vout()

      stage = 'build cancellation PSET with covenant output order'
      const pset = new TxBuilder(lwkNetwork)
        .feeRate(feeRate)
        .setWalletUtxos(params.feeOutpoints.map(o => new OutPoint(o)))
        .setInputOrder([
          new OutPoint(params.pendingOfferOutpoint),
          new OutPoint(params.lenderNftOutpoint),
          new OutPoint(params.borrowerNftOutpoint),
          ...params.feeOutpoints.map(o => new OutPoint(o)),
        ])
        .addExternalUtxos([
          new ExternalUtxo(
            pendingOfferVout,
            pendingOfferTx,
            TxOutSecrets.fromExplicit(collateralAsset, collateralAmount),
            LENDING_MAX_WEIGHT_TO_SATISFY.OfferCancellation,
            true,
          ),
          new ExternalUtxo(
            lenderNftVout,
            lenderNftTx,
            TxOutSecrets.fromExplicit(lenderNftAsset, NFT_AMOUNT),
            SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
          new ExternalUtxo(
            borrowerNftVout,
            borrowerNftTx,
            TxOutSecrets.fromExplicit(borrowerNftAsset, NFT_AMOUNT),
            EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
        ])
        .addPostIssuanceScriptOutput(burnScript, NFT_AMOUNT, lenderNftAsset)
        .addPostIssuanceScriptOutput(burnScript, NFT_AMOUNT, borrowerNftAsset)
        .addPostIssuanceRecipient(collateralRecipient, collateralAmount, collateralAsset)
        .finish(wollet)

      stage = 'sign wallet inputs'
      const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

      const prevouts = [pendingOfferTxOut, lenderNftTxOut, borrowerNftTxOut, ...feeTxOuts]

      stage = 'finalize Lending covenant input'
      const txWithLendingWitness = lendingProgram.finalizeTransactionWithSpendInfo(
        txWithWalletWitnesses,
        lendingSpendInfo,
        prevouts,
        0,
        buildLendingWitness({ branch: 'OfferCancellation' }),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      const prevoutsForScriptAuth = [
        requireTxOut(pendingOfferTx, pendingOfferOutpoint.vout(), 'Pending offer'),
        requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT'),
        requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT'),
        ...feeTxs.map((tx, index) => requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC')),
      ]

      stage = 'finalize Lender NFT ScriptAuth input'
      const finalizedTx = scriptAuthProgram.finalizeTransactionWithSpendInfo(
        txWithLendingWitness,
        buildCovenantSpendInfo(scriptAuthProgram),
        prevoutsForScriptAuth,
        1,
        buildScriptAuthWitness(toUint32(0, 'lendingInputIndex')),
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
            '0 Pending offer Lending': params.pendingOfferOutpoint,
            '1 Lender NFT ScriptAuth': params.lenderNftOutpoint,
            '2 Borrower NFT': params.borrowerNftOutpoint,
            '3+ Fee L-BTC (wallet)': params.feeOutpoints.join(', '),
          },
          outputs: {
            '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
            '1 Borrower NFT burn': bytesToHex(burnScript.bytes()),
            '2 Unlocked collateral': collateralRecipient.toString(),
          },
          assetIds: {
            collateralAssetId: collateralAsset.toString(),
            principalAssetId: AssetId.fromBytes(metadata.principalAssetId).toString(),
            borrowerNftAssetId: borrowerNftAsset.toString(),
            lenderNftAssetId: lenderNftAsset.toString(),
          },
        },
      }
    } catch (err) {
      throw wrapErrorWithContext(err, stage)
    }
  }

  return { cancelOffer }
}
