import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import AcceptOfferModal from '@/components/modals/AcceptOfferModal'
import ClaimModal from '@/components/modals/ClaimModal'
import LiquidateOfferModal from '@/components/modals/LiquidateOfferModal'
import OfferModal from '@/components/modals/OfferModal'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { truncateAddress } from '@/utils/format'
import { resolveOfferActionFromShort, type ViewerRole } from '@/utils/offerActions'
import { getOfferDisplayStatus } from '@/utils/offers'

interface OfferActionModalsProps {
  offer: OfferShort | null
  viewerRole: ViewerRole
  onClose: () => void
  onSuccess: () => void
}

export default function OfferActionModals({
  offer,
  viewerRole,
  onClose,
  onSuccess,
}: OfferActionModalsProps) {
  const blockHeightQuery = useBlockHeight()
  const currentBlockHeight = blockHeightQuery.data ?? 0

  if (!offer) return null

  const action = resolveOfferActionFromShort(offer, viewerRole, currentBlockHeight)

  switch (action) {
    case 'accept':
      return <AcceptOfferModal isOpen offer={offer} onClose={onClose} onSuccess={onSuccess} />
    case 'liquidate':
      return <LiquidateOfferModal isOpen offer={offer} onClose={onClose} onSuccess={onSuccess} />
    case 'claim':
      return <ClaimModal isOpen offer={offer} onClose={onClose} onSuccess={onSuccess} />
    default:
      return (
        <OfferModal
          isOpen
          offer={offer}
          title={`#${truncateAddress(offer.id)}`}
          chip={<OfferStatusChip status={getOfferDisplayStatus(offer, currentBlockHeight)} />}
          principalLabel='Loan Amount'
          onClose={onClose}
        />
      )
  }
}
