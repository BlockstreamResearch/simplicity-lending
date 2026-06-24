import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveActiveOutpoint, resolveLenderNftOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
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
import { useWallet } from '@/providers/wallet/useWallet'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { truncateAddress } from '@/utils/format'

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
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { liquidateOffer } = useLiquidateOffer()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay } = useFormatAmount()

  const liquidateExpiredOffer = async () => {
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

    return liquidateOffer({
      activeOfferOutpoint,
      createOfferTxid: offer.created_at_txid,
      lenderNftOutpoint,
      feeOutpoints: feeUtxos.map(utxoToOutpointString),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({
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
      title={`#${truncateAddress(offer.id)} - Liquidation`}
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
        error: error?.message,
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
