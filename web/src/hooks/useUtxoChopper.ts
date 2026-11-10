import { Address, OutPoint, type TxOutSecrets } from 'lwk_wasm'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { broadcastTx } from '@/api/esplora/methods'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { buildPset, type PsetBlinding } from '@/lwk/psetBuilder'
import { assertDistinctOutpoints, fetchTransaction, requireTxOut } from '@/lwk/transaction'
import { isPolicyAssetUtxo, requireWalletUtxo, WALLET_INPUT_RBF_SEQUENCE } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { getProcessingTxids } from '@/utils/pendingTransactions'

export interface ChopUtxoParams {
  fundingOutpoint: string
  feeOutpoints: string[]
  pieceAmount: bigint
  pieceCount: number
  recipientAddress?: string
}

export interface ChopUtxoResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    amounts: Record<string, string>
  }
}

export function useUtxoChopper() {
  const { lwkNetwork } = useLwk()
  const {
    getReceiveAddress,
    getChangeAddress,
    getBlindedWalletUtxos,
    getWollet,
    signPset,
    syncWallet,
    signerType,
  } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const chopUtxo = async (params: ChopUtxoParams): Promise<ChopUtxoResult> => {
    if (params.pieceAmount <= 0n) throw new Error('Piece amount must be positive')
    if (!Number.isInteger(params.pieceCount) || params.pieceCount <= 0) {
      throw new Error('Piece count must be a positive integer')
    }
    const fundingOutpoint = new OutPoint(params.fundingOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [fundingOutpoint, ...feeOutpoints],
      'Chopper inputs must use distinct outpoints',
    )
    const [receiveAddressString, wollet, feeRate] = await Promise.all([
      getReceiveAddress(),
      getWollet(),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const recipientAddressString = params.recipientAddress?.trim() || receiveAddressString
    const recipient = Address.parse(recipientAddressString, lwkNetwork)
    const recipientSummary = recipient.toString()
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const fundingUtxo = requireWalletUtxo(blindedWalletUtxos, params.fundingOutpoint, 'Funding')
    const policyAsset = lwkNetwork.policyAsset()
    const fundingAsset = fundingUtxo.unblinded().asset()
    const fundingIsLbtc = isPolicyAssetUtxo(fundingUtxo, policyAsset)
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (!fundingIsLbtc && feeUtxos.length === 0) {
      throw new Error(
        `Fee ${NETWORK_CONFIG.collateralAsset.symbol} outpoint(s) are required when chopping a non-${NETWORK_CONFIG.collateralAsset.symbol} asset`,
      )
    }
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, policyAsset))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }

    const fundingAmount = fundingUtxo.unblinded().value()
    const totalOutputAmount = params.pieceAmount * BigInt(params.pieceCount)
    const availableLbtcAmount = fundingIsLbtc
      ? feeUtxos.reduce((sum, utxo) => sum + utxo.unblinded().value(), fundingAmount)
      : 0n
    if (
      fundingIsLbtc ? totalOutputAmount >= availableLbtcAmount : totalOutputAmount > fundingAmount
    ) {
      throw new Error(
        fundingIsLbtc
          ? `Requested ${totalOutputAmount.toString()} units, but selected ${NETWORK_CONFIG.collateralAsset.symbol} inputs only have ${availableLbtcAmount.toString()} sats. Pick a larger UTXO or lower piece count/amount.`
          : `Requested ${totalOutputAmount.toString()} units, but funding asset UTXO only has ${fundingAmount.toString()} units.`,
      )
    }
    const walletUtxos = [fundingUtxo, ...feeUtxos]
    const walletOutpoints = [fundingOutpoint, ...feeOutpoints]
    const walletTxs = await Promise.all(walletOutpoints.map(o => fetchTransaction(o)))
    const blinding: PsetBlinding = signerType === 'humid' ? 'wallet' : 'local'
    const assetChangeAmount = fundingIsLbtc ? 0n : fundingAmount - totalOutputAmount

    const changeAddress = await getChangeAddress()
    const { pset } = buildPset({
      network: lwkNetwork,
      inputs: walletUtxos.map((utxo, index) => ({
        outpoint: walletOutpoints[index],
        prevout: requireTxOut(walletTxs[index], walletOutpoints[index].vout(), 'Wallet input'),
        asset: utxo.unblinded().asset(),
        amount: utxo.unblinded().value(),
        secrets: blinding === 'local' ? (utxo.unblinded() as TxOutSecrets) : undefined,
        walletCoin: true,
        sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
        maxWeightToSatisfy: wollet.maxWeightToSatisfy(),
      })),
      outputs: [
        ...Array.from({ length: params.pieceCount }, () => ({
          script: recipient.scriptPubkey(),
          amount: params.pieceAmount,
          asset: fundingAsset,
          blindingPubkey: recipient.blindingPubkey(),
        })),
        ...(assetChangeAmount > 0n
          ? [
              {
                script: changeAddress.scriptPubkey(),
                amount: assetChangeAmount,
                asset: fundingAsset,
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
    const finalizedTx = wollet.finalize(await signPset(pset)).extractTx()
    const txid = await broadcastTx(finalizedTx.toString())

    return {
      txid,
      summary: {
        inputs: {
          '0 Funding asset': params.fundingOutpoint,
          [`1+ Fee ${NETWORK_CONFIG.collateralAsset.symbol}`]: params.feeOutpoints.length
            ? params.feeOutpoints.join(', ')
            : 'None',
        },
        outputs: {
          'Chopped asset outputs': `${params.pieceCount.toString()} x ${params.pieceAmount.toString()} units to ${recipientSummary}`,
          Change: 'Managed by LWK',
        },
        amounts: {
          fundingAmount: fundingAmount.toString(),
          fundingAssetId: fundingAsset.toString(),
          feeInputAmount: feeUtxos
            .reduce((sum, utxo) => sum + utxo.unblinded().value(), 0n)
            .toString(),
          pieceAmount: params.pieceAmount.toString(),
          pieceCount: params.pieceCount.toString(),
          totalOutputAmount: totalOutputAmount.toString(),
        },
      },
    }
  }

  return { chopUtxo }
}
