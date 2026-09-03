import {
  Address,
  ExternalUtxo,
  OutPoint,
  type Pset,
  SimplicityLogLevel,
  TxBuilder,
  TxOutSecrets,
} from '@lilbonekit/lwk-web'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
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
import {
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY,
  buildAssetAuthVaultSpendInfo,
  buildAssetAuthVaultWitness,
  loadAssetAuthVaultProgram,
} from '@/simplicity/asset-auth-vault/program'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import { getProtocolFee, getTotalAmountToRepay, getTotalFee } from '@/simplicity/lending/utils'
import { bytesToHex } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const NFT_AMOUNT = 1n
const LENDER_NFT_INPUT_INDEX = toUint32(1, 'lenderNftInputIndex')
const LENDER_NFT_OUTPUT_INDEX = toUint32(1, 'lenderNftOutputIndex')
const VAULT_OUTPUT_INDEX = toUint32(0, 'vaultOutputIndex')

export interface LenderVaultWithdrawPartParams {
  lenderVaultOutpoint: string
  lenderNftOutpoint: string
  createOfferTxid: string
  alreadySupplied: string
  amountToWithdraw: string
  feeOutpoints: string[]
  principalRecipientAddress?: string
  lenderNftRecipientAddress?: string
}

export interface LenderVaultWithdrawPartSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
}

export function useLenderVaultWithdrawPart() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const withdrawLenderVaultPart = async (
    params: LenderVaultWithdrawPartParams,
  ): Promise<UpdatedPset<LenderVaultWithdrawPartSummary>> => {
    const lenderVaultOutpoint = new OutPoint(params.lenderVaultOutpoint)
    const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [lenderVaultOutpoint, lenderNftOutpoint, ...feeOutpoints],
      'Lender vault withdraw-part inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const principalRecipient = Address.parse(
      params.principalRecipientAddress?.trim() || receiveAddressString,
      lwkNetwork,
    )
    const lenderNftRecipient = Address.parse(
      params.lenderNftRecipientAddress?.trim() || receiveAddressString,
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

    const alreadySupplied = toUint64(BigInt(params.alreadySupplied.trim()), 'alreadySupplied')
    const amountToWithdraw = toUint64(BigInt(params.amountToWithdraw.trim()), 'amountToWithdraw')
    if (amountToWithdraw <= 0n) throw new Error('Amount to withdraw must be greater than zero')

    const [lenderVaultTx, lenderNftTx, createOfferTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(lenderVaultOutpoint),
      fetchTransaction(lenderNftOutpoint),
      fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])

    const lenderVaultTxOut = requireTxOut(lenderVaultTx, lenderVaultOutpoint.vout(), 'Lender vault')
    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC'),
    )

    // create-offer tx vout 2 = Borrower NFT (asset id needed for program reconstruction). Reading
    // it from the creation tx (already fetched above) works regardless of how many prior
    // supply/withdraw transactions produced the current vault UTXO — unlike reading input 0 of
    // the vault's immediate producer, which is only the Borrower NFT on the vault's first touch.
    const borrowerNftReferenceTxOut = requireTxOut(createOfferTx, 2, 'Borrower NFT reference')
    const borrowerNftAsset = requireExplicitAsset(
      borrowerNftReferenceTxOut,
      'Borrower NFT reference',
    )

    const principalAsset = requireExplicitAsset(lenderVaultTxOut, 'Lender vault')
    const lenderVaultAmount = requireExplicitAmount(lenderVaultTxOut, 'Lender vault')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
    assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')

    if (amountToWithdraw >= lenderVaultAmount) {
      throw new Error(
        `Amount to withdraw must be less than the vault balance (${lenderVaultAmount.toString()})`,
      )
    }

    const metadata = await findPendingOfferMetadata(createOfferTx)
    const offerParameters = {
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
    }
    const lenderVaultSupplyGoal = toUint64(
      getTotalAmountToRepay(offerParameters) - getProtocolFee(getTotalFee(offerParameters)),
      'lenderVaultSupplyGoal',
    )

    const lenderVaultProgram = loadAssetAuthVaultProgram({
      vaultAssetId: toBytes32(principalAsset.toBytes(), 'principalAssetId'),
      keeperAuthAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
      supplierAuthAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      supplyGoal: lenderVaultSupplyGoal,
      withKeeperAssetBurn: true,
      withSupplierAssetBurn: true,
    })
    // WithdrawPart only changes the coin's output value — is_active and already_supplied stay
    // the same, so the input and output covenant spend info are byte-identical here.
    const lenderVaultSpendInfo = buildAssetAuthVaultSpendInfo(lenderVaultProgram, {
      isActive: true,
      alreadySupplied,
    })
    assertScriptMatches(
      lenderVaultTxOut.scriptPubkey(),
      lenderVaultSpendInfo.scriptPubkey,
      'Lender vault output does not match the reconstructed active AssetAuthVault covenant',
    )

    const vaultChangeAmount = toUint64(lenderVaultAmount - amountToWithdraw, 'vaultChangeAmount')

    const inputOrderStrings = [
      params.lenderVaultOutpoint,
      params.lenderNftOutpoint,
      ...params.feeOutpoints,
    ]
    const firstFeeOutpoint = params.feeOutpoints[0]
    if (!firstFeeOutpoint) throw new Error('At least one fee UTXO is required')

    const pset = new TxBuilder(lwkNetwork)
      .feeRate(feeRate)
      .setWalletUtxos(params.feeOutpoints.map(o => new OutPoint(o)))
      .setInputOrder(inputOrderStrings.map(o => new OutPoint(o)))
      .addExternalUtxos([
        new ExternalUtxo(
          lenderVaultOutpoint.vout(),
          lenderVaultTx,
          TxOutSecrets.fromExplicit(principalAsset, lenderVaultAmount),
          ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawPart,
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
      .addPostIssuanceScriptOutput(
        lenderVaultSpendInfo.scriptPubkey,
        vaultChangeAmount,
        principalAsset,
      )
      .addPostIssuanceScriptOutput(lenderNftRecipient.scriptPubkey(), NFT_AMOUNT, lenderNftAsset)
      .addPostIssuanceRecipient(principalRecipient, amountToWithdraw, principalAsset)
      .setInputSequence(new OutPoint(firstFeeOutpoint), WALLET_INPUT_RBF_SEQUENCE)
      .finish(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const txWithWalletWitnesses = wollet.finalize(signedPset).extractTx()

        const prevouts = [lenderVaultTxOut, lenderNftTxOut, ...feeTxOuts]
        const finalizedTx = lenderVaultProgram.finalizeTransactionWithSpendInfo(
          txWithWalletWitnesses,
          lenderVaultSpendInfo,
          prevouts,
          0,
          buildAssetAuthVaultWitness({
            branch: 'WithdrawPart',
            inputKeeperIndex: LENDER_NFT_INPUT_INDEX,
            outputKeeperIndex: LENDER_NFT_OUTPUT_INDEX,
            vaultOutputIndex: VAULT_OUTPUT_INDEX,
            alreadySupplied,
            amountToWithdraw,
          }),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        return {
          finalizedTx,
          summary: {
            inputs: {
              '0 Active lender vault AssetAuthVault': params.lenderVaultOutpoint,
              '1 Lender NFT (wallet)': params.lenderNftOutpoint,
              '2+ Fee L-BTC (wallet)': params.feeOutpoints.join(', '),
            },
            outputs: {
              '0 Lender vault (active, reduced balance)': bytesToHex(
                lenderVaultSpendInfo.scriptPubkey.bytes(),
              ),
              '1 Lender NFT (returned)': lenderNftRecipient.toString(),
              '2 Withdrawn principal': principalRecipient.toString(),
            },
            assetIds: {
              principalAssetId: principalAsset.toString(),
              lenderNftAssetId: lenderNftAsset.toString(),
              borrowerNftAssetId: borrowerNftAsset.toString(),
            },
            amounts: {
              lenderVaultAmount: lenderVaultAmount.toString(),
              alreadySupplied: alreadySupplied.toString(),
              amountToWithdraw: amountToWithdraw.toString(),
              vaultChangeAmount: vaultChangeAmount.toString(),
            },
          },
        }
      },
    }
  }

  return { withdrawLenderVaultPart }
}
