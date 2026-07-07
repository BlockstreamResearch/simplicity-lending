import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useOpenOffer } from '@/hooks/useOfferModal'
import type { OfferNotification } from '@/utils/notifications'

import CardAlert from './CardAlert'

export default function NotificationsModal({
  isOpen,
  onClose,
  title,
  notifications,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  notifications: OfferNotification[]
}) {
  const { openOffer } = useOpenOffer()

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={title}
      footer={
        <UiButton className='w-full' variant='primary' onPress={onClose}>
          Close
        </UiButton>
      }
    >
      <div className='flex flex-col gap-3'>
        {notifications.map(notification => (
          <CardAlert
            key={notification.offer.id}
            variant={notification.variant}
            title={notification.title}
            description={notification.description}
            actionLabel={notification.actionLabel}
            clampDescription={false}
            onAction={() => openOffer(notification.offer)}
          />
        ))}
      </div>
    </UiModal>
  )
}
