import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useLiquidateOfferAction } from '@/hooks/useLiquidateOfferAction'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'

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
  const { scriptPubkey } = useWallet()
  const liquidateOffer = useLiquidateOfferAction()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay } = useFormatAmount()

  const { mutate, reset, data, status } = useMutation({
    mutationFn: () => liquidateOffer(offer.id),
    onSuccess: ({ txid }) => {
      void addPendingTx({
        txid,
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
