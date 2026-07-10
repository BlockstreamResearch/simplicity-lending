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
import { UiButton } from '@/components/ui/UiButton'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'
import { resolveOfferAction } from '@/utils/offerActions'
import {
  getMempoolBlockingTx,
  getOfferPendingTx,
  isBlockingTxStuck,
} from '@/utils/pendingTransactions'

const STUCK_CHECK_INTERVAL_MS = 1_000

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

  const sameOfferPendingTx = offer ? getOfferPendingTx(offer.id, pendingTxs) : null
  const liveAction = offer ? resolveOfferAction(offer, scriptPubkey, currentBlockHeight) : 'none'

  const isBlockedByOtherTx =
    !sameOfferPendingTx && liveAction !== 'none' && Boolean(getMempoolBlockingTx(pendingTxs))
  const isProcessingNow = Boolean(sameOfferPendingTx) || isBlockedByOtherTx

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  const [isProcessingAtOpen, setIsProcessingAtOpen] = useState(isProcessingNow)
  const [isBlockedByOtherTxAtOpen, setIsBlockedByOtherTxAtOpen] = useState(isBlockedByOtherTx)
  const [actionAtOpen, setActionAtOpen] = useState(liveAction)
  const [hasConfirmedRetry, setHasConfirmedRetry] = useState(false)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setIsProcessingAtOpen(isProcessingNow)
      setIsBlockedByOtherTxAtOpen(isBlockedByOtherTx)
      setActionAtOpen(liveAction)
      setHasConfirmedRetry(false)
    }
  }

  useEffect(() => {
    if (isOpen && isProcessingAtOpen && !isProcessingNow) {
      onClose()
    }
  }, [isOpen, isProcessingAtOpen, isProcessingNow, onClose])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STUCK_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const blockingTxForStuckCheck = isBlockedByOtherTxAtOpen
    ? getMempoolBlockingTx(pendingTxs)
    : sameOfferPendingTx
  const isStuck =
    isProcessingAtOpen &&
    blockingTxForStuckCheck !== null &&
    isBlockingTxStuck(blockingTxForStuckCheck, now)

  if (!offer) return null

  if (isProcessingAtOpen && !(isStuck && hasConfirmedRetry)) {
    return (
      <OfferActionShell
        isOpen={isOpen}
        title={`#${truncateAddress(offer.id)}`}
        chip={<OfferStatusChip status={offer.status} isProcessing={!isBlockedByOtherTxAtOpen} />}
        onClose={onClose}
      >
        {isBlockedByOtherTxAtOpen ? (
          isStuck ? (
            <div className='border-warning/30 bg-warning/10 text-warning mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm'>
              <p>
                You have another transaction that hasn&apos;t confirmed yet. You don&apos;t need to
                wait for it — you can go ahead with this one now.
              </p>
              <UiButton
                variant='secondary'
                className='button--warning-soft self-start'
                onPress={() => setHasConfirmedRetry(true)}
              >
                Continue Anyway
              </UiButton>
            </div>
          ) : (
            <div className='border-warning/30 bg-warning/10 text-warning mb-4 rounded-2xl border px-4 py-3 text-sm'>
              You have another transaction that still needs at least 1 confirmation. Please wait
              before starting a new one.
            </div>
          )
        ) : isStuck ? (
          <div className='border-warning/30 bg-warning/10 text-warning mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm'>
            <p>
              This transaction may be stuck — it&apos;s taking longer than usual to confirm. You can
              keep waiting, or send it again.
            </p>
            <UiButton
              variant='secondary'
              className='button--warning-soft self-start'
              onPress={() => setHasConfirmedRetry(true)}
            >
              Send Again
            </UiButton>
          </div>
        ) : (
          <p className='text-muted mb-4 text-sm'>
            Transaction is processing. Actions are temporarily disabled.
          </p>
        )}
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
          <OfferDetailsBody offer={offer} showBalance={false} />
        </OfferActionShell>
      )
  }
}
