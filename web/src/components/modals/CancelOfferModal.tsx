import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { useCancelOfferAction } from '@/hooks/useCancelOfferAction'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'

interface CancelOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function CancelOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: CancelOfferModalProps) {
  const { scriptPubkey } = useWallet()
  const cancelOffer = useCancelOfferAction()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay } = useFormatAmount()

  const { mutate, reset, data, status } = useMutation({
    mutationFn: () => cancelOffer(offer.id),
    onSuccess: ({ txid }) => {
      void addPendingTx({
        txid,
        kind: 'cancel_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'pending',
        expectedOfferStatus: 'cancelled',
      })
    },
  })

  const txSummary = useMemo(
    () => [
      { label: 'Collateral Returned', value: formatCollateralDisplay(offer.collateral_amount) },
    ],
    [offer, formatCollateralDisplay],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Cancel Offer'
      chip={
        <Chip color='danger' variant='soft' size='sm'>
          Cancel
        </Chip>
      }
      action={{
        label: 'Cancel Offer',
        variant: 'danger-soft',
        eyebrow: 'Cancel Offer',
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
      <OfferDetailsBody offer={offer} />
    </OfferActionShell>
  )
}
