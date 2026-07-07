import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { useOpenOffer } from '@/hooks/useOfferModal'
import type { OfferNotification } from '@/utils/notifications'

import CardAlert from './CardAlert'
import NotificationsModal from './NotificationsModal'

export default function CardNotifications({
  notifications,
  title,
}: {
  notifications: OfferNotification[]
  title: string
}) {
  const { openOffer } = useOpenOffer()
  const [isModalOpen, setModalOpen] = useState(false)

  if (notifications.length === 0)
    return (
      <div className='border-muted flex min-h-21 items-center rounded-xl border border-dashed px-4'>
        <p className='text-muted text-sm font-medium'>No notifications yet</p>
      </div>
    )

  const current = notifications[0]
  const moreCount = notifications.length - 1

  return (
    <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5'>
      <div className='min-w-0 flex-1'>
        <CardAlert
          variant={current.variant}
          title={current.title}
          description={current.description}
          actionLabel={current.actionLabel}
          onAction={() => openOffer(current.offer)}
        />
      </div>
      {moreCount > 0 && (
        <UiButton
          variant='ghost'
          size='sm'
          className='text-accent shrink-0 self-end sm:self-auto'
          onPress={() => setModalOpen(true)}
        >
          + {moreCount} more
        </UiButton>
      )}
      <NotificationsModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={title}
        notifications={notifications}
      />
    </div>
  )
}
