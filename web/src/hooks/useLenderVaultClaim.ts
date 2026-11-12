import {
  Address,
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
const BURN_PAYLOAD = new TextEncoder().encode('burn')

const LENDER_NFT_INPUT_INDEX = 1
const LENDER_NFT_BURN_OUTPUT_INDEX = 0

export interface LenderVaultClaimParams {
  lenderVaultOutpoint: string
  lenderNftOutpoint: string
  createOfferTxid: string
  feeOutpoints: string[]
  principalRecipientAddress?: string
}

export interface LenderVaultClaimSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
  scripts: Record<string, string>
}

export function useLenderVaultClaim() {
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

  const claimLenderVault = async (
    params: LenderVaultClaimParams,
  ): Promise<UpdatedPset<LenderVaultClaimSummary>> => {
    const lenderVaultOutpoint = new OutPoint(params.lenderVaultOutpoint)
    const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [lenderVaultOutpoint, lenderNftOutpoint, ...feeOutpoints],
      'Lender vault claim inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const principalRecipient = Address.parse(
      params.principalRecipientAddress?.trim() || receiveAddressString,
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
    const [lenderVaultTx, lenderNftTx, createOfferTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(lenderVaultOutpoint),
      fetchTransaction(lenderNftOutpoint),
      fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])

    // The lender vault was created by the repay tx. Input 0 of that tx was the Borrower NFT
    // (burned there via OP_RETURN). We fetch its predecessor to recover the borrower NFT asset
    // ID needed to reconstruct the finalized AssetAuthVault program parameters.
    const borrowerNftPreRepayOutpoint = lenderVaultTx.inputs[0].outpoint()
    const borrowerNftPreRepayTx = await fetchTransaction(borrowerNftPreRepayOutpoint)
    const lenderVaultTxOut = requireTxOut(lenderVaultTx, lenderVaultOutpoint.vout(), 'Lender vault')
    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
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
      liquidationHeight: metadata.loanExpirationTime,
    })
    const lenderVaultSpendInfo = buildAssetAuthVaultSpendInfo(lenderVaultProgram, {
      isActive: false,
      alreadySupplied: lenderVaultSupplyGoal,
    })

    assertScriptMatches(
      lenderVaultTxOut.scriptPubkey(),
      lenderVaultSpendInfo.scriptPubkey,
      'Lender vault UTXO does not match the reconstructed finalized AssetAuthVault covenant',
    )
    const burnScript = Script.newOpReturn(BURN_PAYLOAD)
    if (feeUtxos.length === 0) throw new Error('At least one fee UTXO is required')
    const blinding: PsetBlinding = signerType === 'humid' ? 'wallet' : 'local'

    const changeAddress = await getChangeAddress()
    const { pset } = buildPset({
      network: lwkNetwork,
      inputs: [
        {
          outpoint: lenderVaultOutpoint,
          prevout: lenderVaultTxOut,
          asset: principalAsset,
          amount: principalAmount,
          maxWeightToSatisfy: ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawAll,
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
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
          maxWeightToSatisfy: wollet.maxWeightToSatisfy(),
        })),
      ],
      outputs: [
        { script: burnScript, amount: NFT_AMOUNT, asset: lenderNftAsset },
        {
          script: principalRecipient.scriptPubkey(),
          amount: principalAmount,
          asset: principalAsset,
          blindingPubkey: principalRecipient.blindingPubkey(),
        },
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

        const prevouts = [lenderVaultTxOut, lenderNftTxOut, ...feeTxOuts]
        const finalizedTx = lenderVaultProgram.finalizeTransaction(
          txWithWalletWitnesses,
          lenderVaultSpendInfo.controlBlock(lenderVaultProgram.cmr),
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

        return {
          finalizedTx,
          // TODO: Remove debug summary before release
          summary: {
            inputs: {
              '0 Finalized lender vault AssetAuthVault': params.lenderVaultOutpoint,
              '1 Lender NFT (wallet)': params.lenderNftOutpoint,
              [`2+ Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
                params.feeOutpoints.join(', '),
            },
            outputs: {
              '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
              '1 Unlocked principal to recipient': principalRecipient.toString(),
              [`${NETWORK_CONFIG.collateralAsset.symbol} change`]: 'Managed by LWK',
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
      },
    }
  }

  return { claimLenderVault }
}
