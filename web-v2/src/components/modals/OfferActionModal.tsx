import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import AcceptOfferModal from '@/components/modals/AcceptOfferModal'
import ClaimModal from '@/components/modals/ClaimModal'
import LiquidateOfferModal from '@/components/modals/LiquidateOfferModal'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'
import { resolveOfferAction } from '@/utils/offerActions'

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

  if (!offer) return null

  const action = resolveOfferAction(offer, scriptPubkey, currentBlockHeight)

  switch (action) {
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
    case 'claim-interest':
      return <ClaimModal isOpen={isOpen} offer={offer} onClose={onClose} onSuccess={onSuccess} />
    default:
      return (
        <OfferActionShell
          isOpen={isOpen}
          title={`#${truncateAddress(offer.id)}`}
          chip={<OfferStatusChip status={offer.status} />}
          onClose={onClose}
        >
          <OfferDetailsBody offer={offer} />
        </OfferActionShell>
      )
  }
}
