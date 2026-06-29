import { useEffect, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import AcceptOfferModal from '@/components/modals/AcceptOfferModal'
import CancelOfferModal from '@/components/modals/CancelOfferModal'
import ClaimModal from '@/components/modals/ClaimModal'
import ClaimPrincipalModal from '@/components/modals/ClaimPrincipalModal'
import LiquidateOfferModal from '@/components/modals/LiquidateOfferModal'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import RepayOfferModal from '@/components/modals/RepayOfferModal'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'
import { resolveOfferAction } from '@/utils/offerActions'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

interface OfferActionModalProps {
  offer: OfferShort | null
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function OfferActionModal({
  offer,
  isOpen,
  onClose,
  onSuccess,
}: OfferActionModalProps) {
  const { scriptPubkey } = useWallet()
  const { data: currentBlockHeight } = useBlockHeight()
  const { pendingTxs } = usePendingTransactions()

  const isProcessingNow = Boolean(offer && getOfferPendingTx(offer.id, pendingTxs))
  const liveAction = offer ? resolveOfferAction(offer, scriptPubkey, currentBlockHeight) : 'none'

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  const [isProcessingAtOpen, setIsProcessingAtOpen] = useState(isProcessingNow)
  const [actionAtOpen, setActionAtOpen] = useState(liveAction)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setIsProcessingAtOpen(isProcessingNow)
      setActionAtOpen(liveAction)
    }
  }

  useEffect(() => {
    if (isOpen && isProcessingAtOpen && !isProcessingNow) {
      onClose()
    }
  }, [isOpen, isProcessingAtOpen, isProcessingNow, onClose])

  if (!offer) return null

  if (isProcessingAtOpen) {
    return (
      <OfferActionShell
        isOpen={isOpen}
        title={`#${truncateAddress(offer.id)}`}
        chip={<OfferStatusChip status={offer.status} isProcessing />}
        onClose={onClose}
      >
        <p className='text-muted mb-4 text-sm'>
          Transaction is processing. Actions are temporarily disabled.
        </p>
        <OfferDetailsBody offer={offer} />
      </OfferActionShell>
    )
  }

  switch (actionAtOpen) {
    case 'accept':
      return (
        <AcceptOfferModal isOpen={isOpen} offer={offer} onClose={onClose} onSuccess={onSuccess} />
      )
    case 'liquidate':
      return (
        <LiquidateOfferModal
          isOpen={isOpen}
          offer={offer}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )
    case 'cancel':
      return (
        <CancelOfferModal isOpen={isOpen} offer={offer} onClose={onClose} onSuccess={onSuccess} />
      )
    case 'claim-principal':
      return (
        <ClaimPrincipalModal
          isOpen={isOpen}
          offer={offer}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )
    case 'repay':
      return (
        <RepayOfferModal isOpen={isOpen} offer={offer} onClose={onClose} onSuccess={onSuccess} />
      )
    case 'claim-interest':
      return <ClaimModal isOpen={isOpen} offer={offer} onClose={onClose} onSuccess={onSuccess} />
    default:
      return (
        <OfferActionShell
          isOpen={isOpen}
          title='Offer Details'
          chip={<OfferStatusChip status={offer.status} />}
          onClose={onClose}
        >
          <OfferDetailsBody offer={offer} />
        </OfferActionShell>
      )
  }
}
