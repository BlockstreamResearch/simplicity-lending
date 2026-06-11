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
import {
  assertDistinctOutpoints,
  assertExplicitAmount,
  assertScriptMatches,
  fetchTransaction,
  requireExplicitAmount,
  requireExplicitAsset,
  requireTxOut,
} from '@/lwk/transaction'
import { isPolicyAssetUtxo, requireWalletUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { buildScriptAuthWitness, loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo, UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { wrapErrorWithContext } from '@/utils/errorHandler'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const DEFAULT_FEE_RATE = 100
const DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY = 30_000
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface CancelOfferParams {
  pendingOfferOutpoint: string
  lenderNftOutpoint: string
  borrowerNftOutpoint: string
  collateralRecipientAddress: string
  feeOutpoint: string
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
  const { getWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const cancelOffer = async (params: CancelOfferParams): Promise<CancelOfferResult> => {
    let stage = 'initializing'

    try {
      stage = 'parse input outpoints'
      const pendingOfferOutpoint = new OutPoint(params.pendingOfferOutpoint)
      const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
      const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
      const feeOutpoint = new OutPoint(params.feeOutpoint)
      assertDistinctOutpoints(
        [pendingOfferOutpoint, lenderNftOutpoint, borrowerNftOutpoint, feeOutpoint],
        'Cancellation inputs must use four distinct outpoints',
      )

      stage = 'load wallet context'
      const wollet = await getWollet()

      stage = 'sync wallet and verify fee input'
      await syncWallet()
      const walletUtxos = await getWalletUtxos()
      const feeUtxo = requireWalletUtxo(walletUtxos, params.feeOutpoint, 'Fee L-BTC')
      if (!isPolicyAssetUtxo(feeUtxo, lwkNetwork.policyAsset())) {
        throw new Error('Fee outpoint must be a wallet L-BTC UTXO')
      }

      stage = 'load input transactions'
      const [pendingOfferTx, lenderNftTx, borrowerNftTx, feeTx] = await Promise.all([
        fetchTransaction(pendingOfferOutpoint),
        fetchTransaction(lenderNftOutpoint),
        fetchTransaction(borrowerNftOutpoint),
        fetchTransaction(feeOutpoint),
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
      const feeTxOut = requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC')

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
        .feeRate(DEFAULT_FEE_RATE)
        .setWalletUtxos([new OutPoint(params.feeOutpoint)])
        .setInputOrder([
          new OutPoint(params.pendingOfferOutpoint),
          new OutPoint(params.lenderNftOutpoint),
          new OutPoint(params.borrowerNftOutpoint),
          new OutPoint(params.feeOutpoint),
        ])
        .addExternalUtxos([
          new ExternalUtxo(
            pendingOfferVout,
            pendingOfferTx,
            TxOutSecrets.fromExplicit(collateralAsset, collateralAmount),
            DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
          new ExternalUtxo(
            lenderNftVout,
            lenderNftTx,
            TxOutSecrets.fromExplicit(lenderNftAsset, NFT_AMOUNT),
            DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
          new ExternalUtxo(
            borrowerNftVout,
            borrowerNftTx,
            TxOutSecrets.fromExplicit(borrowerNftAsset, NFT_AMOUNT),
            DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
        ])
        .addExplicitScriptOutput(burnScript, NFT_AMOUNT, lenderNftAsset)
        .addExplicitScriptOutput(burnScript, NFT_AMOUNT, borrowerNftAsset)
        .addPostIssuanceRecipient(collateralRecipient, collateralAmount, collateralAsset)
        .finish(wollet)

      stage = 'sign wallet inputs'
      const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

      const prevouts = [pendingOfferTxOut, lenderNftTxOut, borrowerNftTxOut, feeTxOut]

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
        requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC'),
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
            '3 Fee L-BTC': params.feeOutpoint,
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
