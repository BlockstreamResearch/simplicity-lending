import {
  Address,
  ExternalUtxo,
  OutPoint,
  SimplicityLogLevel,
  TxBuilder,
  TxOutSecrets,
} from 'lwk_web'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { broadcastTx } from '@/api/esplora/methods'
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
import {
  ASSET_AUTH_MAX_WEIGHT_TO_SATISFY,
  buildAssetAuthWitness,
  loadAssetAuthProgram,
} from '@/simplicity/asset-auth/program'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { bytesToHex } from '@/utils/hex'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n

const BORROWER_NFT_INPUT_INDEX = 1
const BORROWER_NFT_OUTPUT_INDEX = 0

export interface ClaimPrincipalParams {
  principalOutpoint: string
  borrowerNftOutpoint: string
  feeOutpoints: string[]
  borrowerNftRecipientAddress?: string
  principalRecipientAddress?: string
}

export interface ClaimPrincipalResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
    amounts: Record<string, string>
    scripts: Record<string, string>
  }
}

export function useClaimPrincipal() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const claimPrincipal = async (params: ClaimPrincipalParams): Promise<ClaimPrincipalResult> => {
    const principalOutpoint = new OutPoint(params.principalOutpoint)
    const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [principalOutpoint, borrowerNftOutpoint, ...feeOutpoints],
      'Claim principal inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const borrowerNftRecipient = Address.parse(
      params.borrowerNftRecipientAddress?.trim() || receiveAddressString,
      lwkNetwork,
    )
    const principalRecipient = Address.parse(
      params.principalRecipientAddress?.trim() || receiveAddressString,
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
    const [principalTx, borrowerNftTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(principalOutpoint),
      fetchTransaction(borrowerNftOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvb(),
    ])

    const principalTxOut = requireTxOut(principalTx, principalOutpoint.vout(), 'Principal')
    const borrowerNftTxOut = requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC'),
    )

    const principalAsset = requireExplicitAsset(principalTxOut, 'Principal')
    const principalAmount = requireExplicitAmount(principalTxOut, 'Principal')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')
    const assetAuthProgram = loadAssetAuthProgram({
      assetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      assetAmount: toUint64(NFT_AMOUNT, 'borrowerNftAmount'),
      withAssetBurn: false,
    })
    const assetAuthSpendInfo = buildCovenantSpendInfo(assetAuthProgram)

    assertScriptMatches(
      principalTxOut.scriptPubkey(),
      assetAuthSpendInfo.scriptPubkey,
      'Principal UTXO does not match the reconstructed borrower AssetAuth covenant',
    )
    const inputOrderStrings = [
      params.principalOutpoint,
      params.borrowerNftOutpoint,
      ...params.feeOutpoints,
    ]

    const pset = new TxBuilder(lwkNetwork)
      .feeRate(feeRate)
      .setWalletUtxos(params.feeOutpoints.map(o => new OutPoint(o)))
      .setInputOrder(inputOrderStrings.map(o => new OutPoint(o)))
      .addExternalUtxos([
        new ExternalUtxo(
          principalOutpoint.vout(),
          principalTx,
          TxOutSecrets.fromExplicit(principalAsset, principalAmount),
          ASSET_AUTH_MAX_WEIGHT_TO_SATISFY,
          true,
        ),
        new ExternalUtxo(
          borrowerNftOutpoint.vout(),
          borrowerNftTx,
          TxOutSecrets.fromExplicit(borrowerNftAsset, NFT_AMOUNT),
          EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
          true,
        ),
      ])
      .addPostIssuanceScriptOutput(
        borrowerNftRecipient.scriptPubkey(),
        NFT_AMOUNT,
        borrowerNftAsset,
      )
      .addPostIssuanceRecipient(principalRecipient, principalAmount, principalAsset)
      .finish(wollet)
    const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

    const prevouts = [principalTxOut, borrowerNftTxOut, ...feeTxOuts]
    const finalizedTx = assetAuthProgram.finalizeTransactionWithSpendInfo(
      txWithWalletWitnesses,
      assetAuthSpendInfo,
      prevouts,
      0,
      buildAssetAuthWitness({
        inputAssetIndex: toUint32(BORROWER_NFT_INPUT_INDEX, 'borrowerNftInputIndex'),
        outputAssetIndex: toUint32(BORROWER_NFT_OUTPUT_INDEX, 'borrowerNftOutputIndex'),
      }),
      lwkNetwork,
      SimplicityLogLevel.Trace,
    )
    const txid = await broadcastTx(finalizedTx.toString())

    return {
      txid,
      // TODO: Remove debug summary before release
      summary: {
        inputs: {
          '0 Principal AssetAuth': params.principalOutpoint,
          '1 Borrower NFT (wallet)': params.borrowerNftOutpoint,
          '2+ Fee L-BTC (wallet)': params.feeOutpoints.join(', '),
        },
        outputs: {
          '0 Borrower NFT to recipient': borrowerNftRecipient.toString(),
          '1 Unlocked principal to recipient': principalRecipient.toString(),
          'L-BTC change': 'Managed by LWK',
        },
        assetIds: {
          principalAssetId: principalAsset.toString(),
          borrowerNftAssetId: borrowerNftAsset.toString(),
        },
        amounts: {
          principalAmount: principalAmount.toString(),
          borrowerNftAmount: NFT_AMOUNT.toString(),
        },
        scripts: {
          assetAuthScript: bytesToHex(assetAuthSpendInfo.scriptPubkey.bytes()),
          borrowerNftRecipientScript: bytesToHex(borrowerNftRecipient.scriptPubkey().bytes()),
        },
      },
    }
  }

  return { claimPrincipal }
}
