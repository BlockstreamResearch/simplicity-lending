import {
  Address,
  ExternalUtxo,
  OutPoint,
  Script,
  SimplicityLogLevel,
  TxBuilder,
  TxOutSecrets,
} from 'lwk_web'

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
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY,
  buildAssetAuthVaultWitness,
  loadAssetAuthVaultProgram,
} from '@/simplicity/asset-auth-vault/program'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { wrapErrorWithContext } from '@/utils/errorHandler'
import { bytesToHex } from '@/utils/hex'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const DEFAULT_FEE_RATE = 100
const BURN_PAYLOAD = new TextEncoder().encode('burn')

const LENDER_NFT_INPUT_INDEX = 1
const LENDER_NFT_BURN_OUTPUT_INDEX = 0

export interface LenderVaultClaimParams {
  lenderVaultOutpoint: string
  lenderNftOutpoint: string
  feeOutpoint: string
  principalRecipientAddress?: string
}

export interface LenderVaultClaimResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
    amounts: Record<string, string>
    scripts: Record<string, string>
  }
}

export function useLenderVaultClaim() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const claimLenderVault = async (
    params: LenderVaultClaimParams,
  ): Promise<LenderVaultClaimResult> => {
    let stage = 'initializing'

    try {
      stage = 'parse input outpoints'
      const lenderVaultOutpoint = new OutPoint(params.lenderVaultOutpoint)
      const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
      const feeOutpoint = new OutPoint(params.feeOutpoint)
      assertDistinctOutpoints(
        [lenderVaultOutpoint, lenderNftOutpoint, feeOutpoint],
        'Lender vault claim inputs must use three distinct outpoints',
      )

      stage = 'load wallet context'
      const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
      if (!receiveAddressString) throw new Error('Missing wallet receive address')
      const principalRecipient = Address.parse(
        params.principalRecipientAddress?.trim() || receiveAddressString,
        lwkNetwork,
      )

      stage = 'sync wallet and verify fee input'
      await syncWallet()
      const blindedWalletUtxos = await getBlindedWalletUtxos()
      const feeUtxo = requireWalletUtxo(blindedWalletUtxos, params.feeOutpoint, 'Fee L-BTC')
      if (!isPolicyAssetUtxo(feeUtxo, lwkNetwork.policyAsset())) {
        throw new Error('Fee outpoint must be a wallet L-BTC UTXO')
      }

      stage = 'load lender vault, NFT and fee transactions'
      const [lenderVaultTx, lenderNftTx, feeTx] = await Promise.all([
        fetchTransaction(lenderVaultOutpoint),
        fetchTransaction(lenderNftOutpoint),
        fetchTransaction(feeOutpoint),
      ])

      // The lender vault was created by the repay tx. Input 0 of that tx was the Borrower NFT
      // (burned there via OP_RETURN). We fetch its predecessor to recover the borrower NFT asset
      // ID needed to reconstruct the finalized AssetAuthVault program parameters.
      stage = 'trace borrower NFT asset from repayment transaction'
      const borrowerNftPreRepayOutpoint = lenderVaultTx.inputs[0].outpoint()
      const borrowerNftPreRepayTx = await fetchTransaction(borrowerNftPreRepayOutpoint)

      stage = 'extract UTXO values'
      const lenderVaultTxOut = requireTxOut(
        lenderVaultTx,
        lenderVaultOutpoint.vout(),
        'Lender vault',
      )
      const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
      const feeTxOut = requireTxOut(feeTx, feeOutpoint.vout(), 'Fee L-BTC')
      const borrowerNftPreRepayTxOut = requireTxOut(
        borrowerNftPreRepayTx,
        borrowerNftPreRepayOutpoint.vout(),
        'Borrower NFT (pre-repay)',
      )

      const principalAsset = requireExplicitAsset(lenderVaultTxOut, 'Lender vault')
      const principalAmount = requireExplicitAmount(lenderVaultTxOut, 'Lender vault')
      const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
      const borrowerNftAsset = requireExplicitAsset(borrowerNftPreRepayTxOut, 'Borrower NFT')
      assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')

      stage = 'compile finalized AssetAuthVault program'
      const lenderVaultProgram = loadAssetAuthVaultProgram({
        vaultAssetId: toBytes32(principalAsset.toBytes(), 'principalAssetId'),
        keeperAuthAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
        keeperAuthAssetAmount: toUint64(NFT_AMOUNT, 'lenderNftAmount'),
        withKeeperAssetBurn: true,
        supplierAuthAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
        withSupplierAssetBurn: true,
        finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
        isActive: false,
      })
      const lenderVaultSpendInfo = buildCovenantSpendInfo(lenderVaultProgram)

      assertScriptMatches(
        lenderVaultTxOut.scriptPubkey(),
        lenderVaultSpendInfo.scriptPubkey,
        'Lender vault UTXO does not match the reconstructed finalized AssetAuthVault covenant',
      )

      stage = 'build lender vault claim PSET'
      const burnScript = Script.newOpReturn(BURN_PAYLOAD)
      const inputOrderStrings = [
        params.lenderVaultOutpoint,
        params.lenderNftOutpoint,
        params.feeOutpoint,
      ]

      const pset = new TxBuilder(lwkNetwork)
        .feeRate(DEFAULT_FEE_RATE)
        .setWalletUtxos([new OutPoint(params.feeOutpoint)])
        .setInputOrder(inputOrderStrings.map(o => new OutPoint(o)))
        .addExternalUtxos([
          new ExternalUtxo(
            lenderVaultOutpoint.vout(),
            lenderVaultTx,
            TxOutSecrets.fromExplicit(principalAsset, principalAmount),
            ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawAll,
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
        .addPostIssuanceRecipient(principalRecipient, principalAmount, principalAsset)
        .finish(wollet)

      stage = 'sign wallet inputs'
      const txWithWalletWitnesses = wollet.finalize(await signPset(pset)).extractTx()

      const prevouts = [lenderVaultTxOut, lenderNftTxOut, feeTxOut]

      stage = 'finalize AssetAuthVault covenant input'
      const finalizedTx = lenderVaultProgram.finalizeTransactionWithSpendInfo(
        txWithWalletWitnesses,
        lenderVaultSpendInfo,
        prevouts,
        0,
        buildAssetAuthVaultWitness({
          branch: 'WithdrawAll',
          inputKeeperIndex: toUint32(LENDER_NFT_INPUT_INDEX, 'lenderNftInputIndex'),
          outputKeeperIndex: toUint32(LENDER_NFT_BURN_OUTPUT_INDEX, 'lenderNftBurnOutputIndex'),
        }),
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
            '0 Finalized lender vault AssetAuthVault': params.lenderVaultOutpoint,
            '1 Lender NFT (wallet)': params.lenderNftOutpoint,
            '2 Fee L-BTC': params.feeOutpoint,
          },
          outputs: {
            '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
            '1 Unlocked principal to recipient': principalRecipient.toString(),
            'L-BTC change': 'Managed by LWK',
          },
          assetIds: {
            principalAssetId: principalAsset.toString(),
            lenderNftAssetId: lenderNftAsset.toString(),
            borrowerNftAssetId: borrowerNftAsset.toString(),
          },
          amounts: {
            principalAmount: principalAmount.toString(),
            lenderNftAmount: NFT_AMOUNT.toString(),
          },
          scripts: {
            lenderVaultScript: bytesToHex(lenderVaultSpendInfo.scriptPubkey.bytes()),
            burnScript: bytesToHex(burnScript.bytes()),
            principalRecipientScript: bytesToHex(principalRecipient.scriptPubkey().bytes()),
          },
        },
      }
    } catch (err) {
      throw wrapErrorWithContext(err, stage)
    }
  }

  return { claimLenderVault }
}
