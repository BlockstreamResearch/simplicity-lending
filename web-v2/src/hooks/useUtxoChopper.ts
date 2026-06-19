import { Address, OutPoint, TxBuilder } from 'lwk_web'

import { broadcastTx } from '@/api/esplora/methods'
import { fetchFeeRateSatPerKvb } from '@/lwk/fee'
import { assertDistinctOutpoints } from '@/lwk/transaction'
import { isPolicyAssetUtxo, requireWalletUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { wrapErrorWithContext } from '@/utils/errorHandler'

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
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const chopUtxo = async (params: ChopUtxoParams): Promise<ChopUtxoResult> => {
    let stage = 'initializing'

    try {
      stage = 'validate params'
      if (params.pieceAmount <= 0n) throw new Error('Piece amount must be positive')
      if (!Number.isInteger(params.pieceCount) || params.pieceCount <= 0) {
        throw new Error('Piece count must be a positive integer')
      }

      stage = 'parse input outpoints'
      const fundingOutpoint = new OutPoint(params.fundingOutpoint)
      const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
      assertDistinctOutpoints(
        [fundingOutpoint, ...feeOutpoints],
        'Chopper inputs must use distinct outpoints',
      )

      stage = 'load wallet context'
      const [receiveAddressString, wollet, feeRate] = await Promise.all([
        getReceiveAddress(),
        getWollet(),
        fetchFeeRateSatPerKvb(),
      ])
      if (!receiveAddressString) throw new Error('Missing wallet receive address')
      const recipientAddressString = params.recipientAddress?.trim() || receiveAddressString
      const recipient = Address.parse(recipientAddressString, lwkNetwork)
      const lbtcChangeRecipient = Address.parse(recipientAddressString, lwkNetwork)
      const recipientSummary = recipient.toString()

      stage = 'sync wallet and verify funding input'
      await syncWallet()
      const blindedWalletUtxos = await getBlindedWalletUtxos()
      const fundingUtxo = requireWalletUtxo(blindedWalletUtxos, params.fundingOutpoint, 'Funding')
      const policyAsset = lwkNetwork.policyAsset()
      const fundingAsset = fundingUtxo.unblinded().asset()
      const fundingIsLbtc = isPolicyAssetUtxo(fundingUtxo, policyAsset)
      const feeUtxos = params.feeOutpoints.map(o =>
        requireWalletUtxo(blindedWalletUtxos, o, 'Fee L-BTC'),
      )
      if (!fundingIsLbtc && feeUtxos.length === 0) {
        throw new Error('Fee L-BTC outpoint(s) are required when chopping a non-L-BTC asset')
      }
      if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, policyAsset))) {
        throw new Error('Fee outpoints must be wallet L-BTC UTXOs')
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
            ? `Requested ${totalOutputAmount.toString()} units, but selected L-BTC inputs only have ${availableLbtcAmount.toString()} sats. Pick a larger UTXO or lower piece count/amount.`
            : `Requested ${totalOutputAmount.toString()} units, but funding asset UTXO only has ${fundingAmount.toString()} units.`,
        )
      }

      stage = 'build chop PSET'
      const walletInputOutpointStrings = [params.fundingOutpoint, ...params.feeOutpoints]
      let txBuilder = new TxBuilder(lwkNetwork)
        .feeRate(feeRate)
        .setWalletUtxos(walletInputOutpointStrings.map(o => new OutPoint(o)))
        .setInputOrder(walletInputOutpointStrings.map(o => new OutPoint(o)))

      for (let index = 0; index < params.pieceCount; index += 1) {
        txBuilder = fundingIsLbtc
          ? txBuilder.addLbtcRecipient(recipient, params.pieceAmount)
          : txBuilder.addRecipient(recipient, params.pieceAmount, fundingAsset)
      }

      txBuilder = txBuilder.drainLbtcTo(lbtcChangeRecipient)

      const pset = txBuilder.finish(wollet)

      stage = 'sign wallet input'
      const finalizedTx = wollet.finalize(await signPset(pset)).extractTx()

      stage = 'broadcast transaction'
      const txid = await broadcastTx(finalizedTx.toString())

      return {
        txid,
        summary: {
          inputs: {
            '0 Funding asset': params.fundingOutpoint,
            '1+ Fee L-BTC': params.feeOutpoints.length ? params.feeOutpoints.join(', ') : 'None',
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
    } catch (err) {
      throw wrapErrorWithContext(err, stage)
    }
  }

  return { chopUtxo }
}
