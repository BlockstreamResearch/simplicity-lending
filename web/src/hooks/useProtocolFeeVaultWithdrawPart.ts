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
import { getProtocolFee, getTotalFee } from '@/simplicity/lending/utils'
import { bytesToHex } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'

const KEEPER_INPUT_INDEX = toUint32(1, 'keeperInputIndex')
const KEEPER_OUTPUT_INDEX = toUint32(1, 'keeperOutputIndex')
const VAULT_OUTPUT_INDEX = toUint32(0, 'vaultOutputIndex')

export interface ProtocolFeeVaultWithdrawPartParams {
  protocolFeeVaultOutpoint: string
  keeperOutpoint: string
  createOfferTxid: string
  alreadySupplied: string
  amountToWithdraw: string
  feeOutpoints: string[]
  keeperRecipientAddress?: string
  principalRecipientAddress?: string
}

export interface ProtocolFeeVaultWithdrawPartSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
}

export function useProtocolFeeVaultWithdrawPart() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const withdrawProtocolFeeVaultPart = async (
    params: ProtocolFeeVaultWithdrawPartParams,
  ): Promise<UpdatedPset<ProtocolFeeVaultWithdrawPartSummary>> => {
    const protocolFeeVaultOutpoint = new OutPoint(params.protocolFeeVaultOutpoint)
    const keeperOutpoint = new OutPoint(params.keeperOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [protocolFeeVaultOutpoint, keeperOutpoint, ...feeOutpoints],
      'Protocol fee vault withdraw-part inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const keeperRecipient = Address.parse(
      params.keeperRecipientAddress?.trim() || receiveAddressString,
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

    const alreadySupplied = toUint64(BigInt(params.alreadySupplied.trim()), 'alreadySupplied')
    const amountToWithdraw = toUint64(BigInt(params.amountToWithdraw.trim()), 'amountToWithdraw')
    if (amountToWithdraw <= 0n) throw new Error('Amount to withdraw must be greater than zero')

    const [protocolFeeVaultTx, keeperTx, createOfferTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(protocolFeeVaultOutpoint),
      fetchTransaction(keeperOutpoint),
      fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])

    const borrowerNftPreTouchOutpoint = protocolFeeVaultTx.inputs[0].outpoint()
    const borrowerNftPreTouchTx = await fetchTransaction(borrowerNftPreTouchOutpoint)

    const protocolFeeVaultTxOut = requireTxOut(
      protocolFeeVaultTx,
      protocolFeeVaultOutpoint.vout(),
      'Protocol fee vault',
    )
    const keeperTxOut = requireTxOut(keeperTx, keeperOutpoint.vout(), 'Protocol fee keeper')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), 'Fee L-BTC'),
    )
    const borrowerNftPreTouchTxOut = requireTxOut(
      borrowerNftPreTouchTx,
      borrowerNftPreTouchOutpoint.vout(),
      'Borrower NFT (pre-touch)',
    )

    const principalAsset = requireExplicitAsset(protocolFeeVaultTxOut, 'Protocol fee vault')
    const protocolFeeVaultAmount = requireExplicitAmount(
      protocolFeeVaultTxOut,
      'Protocol fee vault',
    )
    const keeperAsset = requireExplicitAsset(keeperTxOut, 'Protocol fee keeper')
    const keeperAmount = requireExplicitAmount(keeperTxOut, 'Protocol fee keeper')
    const borrowerNftAsset = requireExplicitAsset(
      borrowerNftPreTouchTxOut,
      'Borrower NFT (pre-touch)',
    )

    if (amountToWithdraw >= protocolFeeVaultAmount) {
      throw new Error(
        `Amount to withdraw must be less than the vault balance (${protocolFeeVaultAmount.toString()})`,
      )
    }

    const metadata = await findPendingOfferMetadata(createOfferTx)
    const offerParameters = {
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
    }
    const protocolFeeVaultSupplyGoal = getProtocolFee(getTotalFee(offerParameters))

    const protocolFeeVaultProgram = loadAssetAuthVaultProgram({
      vaultAssetId: toBytes32(principalAsset.toBytes(), 'principalAssetId'),
      keeperAuthAssetId: toBytes32(keeperAsset.toBytes(), 'keeperAssetId'),
      supplierAuthAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      supplyGoal: protocolFeeVaultSupplyGoal,
      withKeeperAssetBurn: false,
      withSupplierAssetBurn: false,
    })
    const protocolFeeVaultInputSpendInfo = buildAssetAuthVaultSpendInfo(protocolFeeVaultProgram, {
      isActive: true,
      alreadySupplied,
    })
    assertScriptMatches(
      protocolFeeVaultTxOut.scriptPubkey(),
      protocolFeeVaultInputSpendInfo.scriptPubkey,
      'Protocol fee vault output does not match the reconstructed active AssetAuthVault covenant',
    )

    const vaultChangeAmount = toUint64(
      protocolFeeVaultAmount - amountToWithdraw,
      'vaultChangeAmount',
    )
    const protocolFeeVaultOutputSpendInfo = buildAssetAuthVaultSpendInfo(protocolFeeVaultProgram, {
      isActive: true,
      alreadySupplied,
    })

    const inputOrderStrings = [
      params.protocolFeeVaultOutpoint,
      params.keeperOutpoint,
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
          protocolFeeVaultOutpoint.vout(),
          protocolFeeVaultTx,
          TxOutSecrets.fromExplicit(principalAsset, protocolFeeVaultAmount),
          ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawPart,
          true,
        ),
        new ExternalUtxo(
          keeperOutpoint.vout(),
          keeperTx,
          TxOutSecrets.fromExplicit(keeperAsset, keeperAmount),
          EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
          true,
        ),
      ])
      .addPostIssuanceScriptOutput(
        protocolFeeVaultOutputSpendInfo.scriptPubkey,
        vaultChangeAmount,
        principalAsset,
      )
      .addPostIssuanceScriptOutput(keeperRecipient.scriptPubkey(), keeperAmount, keeperAsset)
      .addPostIssuanceRecipient(principalRecipient, amountToWithdraw, principalAsset)
      .setInputSequence(new OutPoint(firstFeeOutpoint), WALLET_INPUT_RBF_SEQUENCE)
      .finish(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const txWithWalletWitnesses = wollet.finalize(signedPset).extractTx()

        const prevouts = [protocolFeeVaultTxOut, keeperTxOut, ...feeTxOuts]
        const finalizedTx = protocolFeeVaultProgram.finalizeTransactionWithSpendInfo(
          txWithWalletWitnesses,
          protocolFeeVaultInputSpendInfo,
          prevouts,
          0,
          buildAssetAuthVaultWitness({
            branch: 'WithdrawPart',
            inputKeeperIndex: KEEPER_INPUT_INDEX,
            outputKeeperIndex: KEEPER_OUTPUT_INDEX,
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
              '0 Active protocol-fee vault AssetAuthVault': params.protocolFeeVaultOutpoint,
              '1 Protocol fee keeper (wallet)': params.keeperOutpoint,
              '2+ Fee L-BTC (wallet)': params.feeOutpoints.join(', '),
            },
            outputs: {
              '0 Protocol fee vault (active, reduced balance)': bytesToHex(
                protocolFeeVaultOutputSpendInfo.scriptPubkey.bytes(),
              ),
              '1 Protocol fee keeper (passed through)': keeperRecipient.toString(),
              '2 Withdrawn principal fee': principalRecipient.toString(),
            },
            assetIds: {
              principalAssetId: principalAsset.toString(),
              keeperAssetId: keeperAsset.toString(),
              borrowerNftAssetId: borrowerNftAsset.toString(),
            },
            amounts: {
              protocolFeeVaultAmount: protocolFeeVaultAmount.toString(),
              alreadySupplied: alreadySupplied.toString(),
              amountToWithdraw: amountToWithdraw.toString(),
              vaultChangeAmount: vaultChangeAmount.toString(),
            },
          },
        }
      },
    }
  }

  return { withdrawProtocolFeeVaultPart }
}
