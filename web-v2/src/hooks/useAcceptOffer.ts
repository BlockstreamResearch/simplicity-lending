import {
  Address,
  AssetId,
  ExternalUtxo,
  OutPoint,
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
  assertWalletUtxoAssetAndMinimumAmount,
  isPolicyAssetUtxo,
  requireWalletUtxo,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
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
import { wrapErrorWithContext } from '@/utils/errorHandler'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n

export interface AcceptOfferParams {
  pendingOfferOutpoint: string
  lenderNftOutpoint: string
  borrowerNftReferenceOutpoint: string
  principalOutpoint: string
  feeOutpoint: string
  lenderNftRecipientAddress?: string
}

export interface AcceptOfferResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
    offerParameters: Record<string, string>
    scripts: Record<string, string>
  }
}

export function useAcceptOffer() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const acceptOffer = async (params: AcceptOfferParams): Promise<AcceptOfferResult> => {
    let stage = 'initializing'

    try {
      stage = 'parse input outpoints'
      const pendingOfferOutpoint = new OutPoint(params.pendingOfferOutpoint)
      const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
      const borrowerNftReferenceOutpoint = new OutPoint(params.borrowerNftReferenceOutpoint)
      const principalOutpoint = new OutPoint(params.principalOutpoint)
      const feeOutpoint = new OutPoint(params.feeOutpoint)
      assertDistinctOutpoints(
        [
          pendingOfferOutpoint,
          lenderNftOutpoint,
          borrowerNftReferenceOutpoint,
          principalOutpoint,
          feeOutpoint,
        ],
        'Acceptance outpoints must be distinct',
      )

      stage = 'load wallet context'
      const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
      if (!receiveAddressString) throw new Error('Missing receive address')
      const walletReceiveAddress = Address.parse(receiveAddressString, lwkNetwork)
      const lenderNftRecipient = Address.parse(
        params.lenderNftRecipientAddress?.trim() || receiveAddressString,
        lwkNetwork,
      ).toUnconfidential()

      stage = 'sync wallet and verify fee input'
      await syncWallet()
      const blindedWalletUtxos = await getBlindedWalletUtxos()
      const principalUtxo = requireWalletUtxo(
        blindedWalletUtxos,
        params.principalOutpoint,
        'Principal',
      )
      const feeUtxo = requireWalletUtxo(blindedWalletUtxos, params.feeOutpoint, 'Fee L-BTC')
      if (!isPolicyAssetUtxo(feeUtxo, lwkNetwork.policyAsset())) {
        throw new Error('Fee outpoint must be a wallet L-BTC UTXO')
      }

      stage = 'load covenant and reference transactions'
      const [pendingOfferTx, lenderNftTx, borrowerNftTx, feeTx, feeRate] = await Promise.all([
        fetchTransaction(pendingOfferOutpoint),
        fetchTransaction(lenderNftOutpoint),
        fetchTransaction(borrowerNftReferenceOutpoint),
        fetchTransaction(feeOutpoint),
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
        borrowerNftReferenceOutpoint.vout(),
        'Borrower NFT reference',
      )
      const feeTxOut = requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC')

      const collateralAsset = requireExplicitAsset(pendingOfferTxOut, 'Pending offer')
      const collateralAmount = requireExplicitAmount(pendingOfferTxOut, 'Pending offer')
      const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
      const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT reference')
      assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')
      assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT reference')

      stage = 'recover pending offer parameters'
      const metadata = await findPendingOfferMetadata(pendingOfferTx)
      const principalAsset = AssetId.fromBytes(metadata.principalAssetId)

      stage = 'verify principal wallet input'
      assertWalletUtxoAssetAndMinimumAmount(
        principalUtxo,
        principalAsset,
        metadata.principalAmount,
        'Principal',
      )
      const principalInputAmount = principalUtxo.unblinded().value()
      const principalChangeAmount = principalInputAmount - metadata.principalAmount
      assertDistinctOutpoints(
        [pendingOfferOutpoint, lenderNftOutpoint, principalOutpoint, feeOutpoint],
        'Acceptance inputs must use distinct outpoints',
      )

      stage = 'compile Lending, ScriptAuth, and AssetAuth programs'
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
      const activeLendingSpendInfo = buildLendingOfferSpendInfo(
        lendingProgram,
        offerParameters,
        true,
      )

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

      stage = 'load principal input transaction'
      const principalTransaction = await fetchTransaction(principalOutpoint)
      const principalTxOut = requireTxOut(
        principalTransaction,
        principalOutpoint.vout(),
        'Principal input',
      )

      stage = 'build acceptance PSET'
      const walletInputOutpointStrings = [params.principalOutpoint, params.feeOutpoint]
      const inputOrderStrings = [
        params.pendingOfferOutpoint,
        params.lenderNftOutpoint,
        ...walletInputOutpointStrings,
      ]
      const pendingOfferVout = pendingOfferOutpoint.vout()
      const lenderNftVout = lenderNftOutpoint.vout()
      let txBuilder = new TxBuilder(lwkNetwork)
        .feeRate(feeRate)
        .setWalletUtxos(walletInputOutpointStrings.map(outpoint => new OutPoint(outpoint)))
        .setInputOrder(inputOrderStrings.map(outpoint => new OutPoint(outpoint)))
        .addExternalUtxos([
          new ExternalUtxo(
            pendingOfferVout,
            pendingOfferTx,
            TxOutSecrets.fromExplicit(collateralAsset, collateralAmount),
            LENDING_MAX_WEIGHT_TO_SATISFY.OfferAcceptance,
            true,
          ),
          new ExternalUtxo(
            lenderNftVout,
            lenderNftTx,
            TxOutSecrets.fromExplicit(lenderNftAsset, NFT_AMOUNT),
            SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
            true,
          ),
        ])
        .addPostIssuanceScriptOutput(
          activeLendingSpendInfo.scriptPubkey,
          collateralAmount,
          collateralAsset,
        )
        .addPostIssuanceScriptOutput(
          principalOutputSpendInfo.scriptPubkey,
          metadata.principalAmount,
          principalAsset,
        )
        .addPostIssuanceScriptOutput(lenderNftRecipient.scriptPubkey(), NFT_AMOUNT, lenderNftAsset)

      if (principalChangeAmount > 0n) {
        txBuilder = txBuilder.addPostIssuanceRecipient(
          walletReceiveAddress,
          principalChangeAmount,
          principalAsset,
        )
      }

      const pset = txBuilder.finish(wollet)

      stage = 'verify acceptance transaction layout'
      const unsignedTx = pset.extractTx()
      // TODO: Remove acceptance output layout debug logging.
      const expectedOutputLayout = [
        {
          role: 'active Lending covenant',
          script: bytesToHex(activeLendingSpendInfo.scriptPubkey.bytes()),
          asset: collateralAsset.toString(),
          amount: collateralAmount.toString(),
        },
        {
          role: 'borrower principal AssetAuth covenant',
          script: bytesToHex(principalOutputSpendInfo.scriptPubkey.bytes()),
          asset: principalAsset.toString(),
          amount: metadata.principalAmount.toString(),
        },
        {
          role: 'lender NFT recipient',
          script: bytesToHex(lenderNftRecipient.scriptPubkey().bytes()),
          asset: lenderNftAsset.toString(),
          amount: NFT_AMOUNT.toString(),
        },
        ...(principalChangeAmount > 0n
          ? [
              {
                role: 'principal change',
                script: bytesToHex(walletReceiveAddress.scriptPubkey().bytes()),
                asset: principalAsset.toString(),
                amount: principalChangeAmount.toString(),
              },
            ]
          : []),
      ]
      const actualOutputLayout = unsignedTx.outputs.map((output, vout) => {
        const script = bytesToHex(output.scriptPubkey().bytes())
        const asset = output.asset()?.toString() ?? 'confidential'
        const amount = output.value()?.toString() ?? 'confidential'
        const matchedRole =
          expectedOutputLayout.find(
            expected =>
              expected.script === script && expected.asset === asset && expected.amount === amount,
          )?.role ?? (output.isFee() ? 'fee' : 'change or unexpected')

        return {
          vout,
          matchedRole,
          asset,
          amount,
          script,
          address: output.unconfidentialAddress(lwkNetwork)?.toString() ?? '',
          partiallyBlinded: output.isPartiallyBlinded(),
        }
      })
      console.error('[AcceptOffer] acceptance output layout', {
        expected: expectedOutputLayout,
        actual: actualOutputLayout,
      })

      const actualInputOrder = unsignedTx.inputs.map(input => {
        const outpoint = input.outpoint()
        return `${outpoint.txid().toString()}:${outpoint.vout()}`
      })
      if (
        actualInputOrder.length !== inputOrderStrings.length ||
        actualInputOrder.some((outpoint, index) => outpoint !== inputOrderStrings[index])
      ) {
        throw new Error('LWK changed the required acceptance input order')
      }

      const activeOfferOutput = requireTxOut(unsignedTx, 0, 'Active offer')
      assertScriptMatches(
        activeOfferOutput.scriptPubkey(),
        activeLendingSpendInfo.scriptPubkey,
        'Acceptance output 0 must be the active Lending covenant',
      )
      assertExplicitAmount(activeOfferOutput, collateralAmount, 'Active offer')
      if (
        requireExplicitAsset(activeOfferOutput, 'Active offer').toString() !==
        collateralAsset.toString()
      ) {
        throw new Error('Acceptance output 0 must preserve the collateral asset')
      }

      const borrowerPrincipalOutput = requireTxOut(unsignedTx, 1, 'Borrower principal')
      assertScriptMatches(
        borrowerPrincipalOutput.scriptPubkey(),
        principalOutputSpendInfo.scriptPubkey,
        'Acceptance output 1 must be the borrower principal AssetAuth covenant',
      )
      assertExplicitAmount(borrowerPrincipalOutput, metadata.principalAmount, 'Borrower principal')
      if (
        requireExplicitAsset(borrowerPrincipalOutput, 'Borrower principal').toString() !==
        principalAsset.toString()
      ) {
        throw new Error('Acceptance output 1 must use the principal asset')
      }

      const lenderNftOutput = requireTxOut(unsignedTx, 2, 'Lender NFT')
      assertScriptMatches(
        lenderNftOutput.scriptPubkey(),
        lenderNftRecipient.scriptPubkey(),
        'Acceptance output 2 must send the Lender NFT to the lender',
      )
      assertExplicitAmount(lenderNftOutput, NFT_AMOUNT, 'Lender NFT')
      if (
        requireExplicitAsset(lenderNftOutput, 'Lender NFT').toString() !== lenderNftAsset.toString()
      ) {
        throw new Error('Acceptance output 2 must preserve the Lender NFT asset')
      }

      stage = 'sign wallet inputs'
      const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

      const prevouts = [pendingOfferTxOut, lenderNftTxOut, principalTxOut, feeTxOut]

      stage = 'finalize Lending covenant input'
      const txWithLendingWitness = lendingProgram.finalizeTransactionWithSpendInfo(
        txWithWalletWitnesses,
        pendingLendingSpendInfo,
        prevouts,
        0,
        buildLendingWitness({ branch: 'OfferAcceptance' }),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      const scriptAuthPrevouts = [
        requireTxOut(pendingOfferTx, pendingOfferOutpoint.vout(), 'Pending offer'),
        requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT'),
        requireTxOut(principalTransaction, principalOutpoint.vout(), 'Principal input'),
        requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC'),
      ]

      stage = 'finalize Lender NFT ScriptAuth input'
      const finalizedTx = scriptAuthProgram.finalizeTransactionWithSpendInfo(
        txWithLendingWitness,
        scriptAuthSpendInfo,
        scriptAuthPrevouts,
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
            '2 Principal wallet UTXO': params.principalOutpoint,
            '3 Fee L-BTC': params.feeOutpoint,
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
    } catch (err) {
      throw wrapErrorWithContext(err, stage)
    }
  }

  return { acceptOffer }
}
