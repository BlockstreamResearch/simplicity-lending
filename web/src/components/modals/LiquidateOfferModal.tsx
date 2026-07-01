import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { broadcastTx } from '@/api/esplora/methods'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveActiveOutpoint, resolveLenderNftOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useLiquidateOffer } from '@/hooks/useLiquidateOffer'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'

const LIQUIDATE_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.Liquidation + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface LiquidateOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function LiquidateOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: LiquidateOfferModalProps) {
  const { syncWallet, getBlindedWalletUtxos, signPset, signerType, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { liquidateOffer } = useLiquidateOffer()
  const { start, fail } = useTxProgress()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay } = useFormatAmount()

  const liquidateExpiredOffer = async () => {
    try {
      const advance = await start(getDefaultTransactionSteps(signerType))
      const fullOffer = await fetchOffer(offer.id)
      const activeOfferOutpoint = resolveActiveOutpoint(fullOffer)
      if (!activeOfferOutpoint) throw new Error('Active offer UTXO not found')

      const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
      if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])
      const feeBudgetSats = estimateFeeBudgetSats(LIQUIDATE_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      const { pset, finalize } = await liquidateOffer({
        activeOfferOutpoint,
        createOfferTxid: offer.created_at_txid,
        lenderNftOutpoint,
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })

      await advance('signing')
      const signedPset = await signPset(pset)

      await advance('finalizing')
      const { finalizedTx, summary } = finalize(signedPset)

      await advance('broadcasting')
      const txid = await broadcastTx(finalizedTx.toString())

      return { txid, summary }
    } catch (err) {
      fail(err)
      throw err
    }
  }

  const { mutate, reset, data, status } = useMutation({
    mutationFn: liquidateExpiredOffer,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'liquidate_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        expectedOfferStatus: 'liquidated',
      })
    },
  })

  const txSummary = useMemo(
    () => [
      { label: 'Collateral', value: formatCollateralDisplay(offer.collateral_amount) },
      { label: 'Expiration Block', value: `#${offer.loan_expiration_height}` },
    ],
    [offer, formatCollateralDisplay],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Liquidate Offer'
      chip={
        <Chip color='danger' variant='soft' size='sm'>
          Liquidate
        </Chip>
      }
      action={{
        label: 'Liquidate & Claim Collateral',
        variant: 'danger-soft',
        eyebrow: 'Liquidate Offer',
        summary: txSummary,
        status,
        txid: data?.txid,
        onConfirm: () => mutate(),
      }}
      onClose={() => {
        reset()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <OfferDetailsBody offer={offer} highlightTerm />
    </OfferActionShell>
  )
}
