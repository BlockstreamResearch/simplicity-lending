import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferDetails } from '@/api/indexer/schemas'
import { UiModal } from '@/components/ui/UiModal'
import { useBlockDate } from '@/hooks/useBlockDate'
import { formatDateTime } from '@/utils/format'
import type { ActorRole } from '@/utils/offerActions'

import { formatBlocksAgo } from '../../helpers'
import ActivityEventDetailsBody from './ActivityEventDetailsBody'
import ActivityEventHeader from './ActivityEventHeader'
import { ACTIVITY_EVENT_CONFIG } from './constants'
import type { OfferActivityEvent } from './helpers'

interface ActivityEventModalProps {
  offer: OfferDetails
  role: ActorRole
  event: OfferActivityEvent
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export default function ActivityEventModal({
  offer,
  role,
  event,
  isOpen,
  onOpenChange,
}: ActivityEventModalProps) {
  const { data: currentBlockHeight } = useBlockHeight()
  const eventDate = useBlockDate(event.height)
  const { title, Icon, tone } = ACTIVITY_EVENT_CONFIG[event.type]

  const caption = [
    eventDate ? formatDateTime(eventDate) : '–',
    formatBlocksAgo(currentBlockHeight, event.height),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-162'
      title={
        <ActivityEventHeader
          title={title}
          icon={<Icon className='size-4' />}
          tone={tone}
          caption={caption}
          actor={event.actor}
        />
      }
    >
      <ActivityEventDetailsBody offer={offer} role={role} event={event} />
    </UiModal>
  )
}
