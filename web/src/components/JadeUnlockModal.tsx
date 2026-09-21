import { Spinner } from '@heroui/react'
import { useState } from 'react'

import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useWallet } from '@/providers/walletFacade/useWallet'

/**
 * What a person sees while their device is waiting for its PIN.
 *
 * It reads the facade like every other screen and names no wallet: what is being unlocked is
 * whichever wallet reported itself locked, and a retry goes back to that one.
 */
export function JadeUnlockModal() {
  const {
    connectionStatus,
    connectorId,
    walletVariant,
    error,
    isError,
    connect,
    usbDeviceDetected,
  } = useWallet()
  const [prevConnectionStatus, setPrevConnectionStatus] = useState(connectionStatus)
  const [isOpen, setIsOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)

  if (connectionStatus !== prevConnectionStatus) {
    setPrevConnectionStatus(connectionStatus)
    if (connectionStatus === 'locked') setIsOpen(true)
    else if (connectionStatus === 'ready' || !isError) setIsOpen(false)
  }

  // Stay open across a retry — only swap the inner content — instead of closing and
  // reopening, which played the modal's exit/enter transition back to back and read as
  // a flicker/reload.
  if (isOpen && !usbDeviceDetected) setIsOpen(false)
  const failed = isOpen && isError && connectionStatus !== 'locked' && !retrying

  const handleDismiss = () => setIsOpen(false)

  const handleRetry = () => {
    if (!connectorId) return

    setRetrying(true)
    connect(connectorId, { variant: walletVariant ?? undefined })
      .catch(console.warn)
      .finally(() => setRetrying(false))
  }

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={() => {}}
      isDismissable={false}
      showCloseButton={false}
      title={failed ? 'Unlock failed' : 'Unlock your Jade'}
    >
      {failed ? (
        <div className='flex flex-col items-center gap-4 py-2 text-center'>
          <span className='bg-danger/10 flex size-14 items-center justify-center rounded-full'>
            <span className='bg-danger/15 text-danger animate-shake flex size-10 items-center justify-center rounded-full'>
              <CircleExclamationIcon className='size-5' />
            </span>
          </span>
          <p className='text-muted text-sm'>{error}</p>
          <div className='flex gap-2'>
            <UiButton variant='secondary' onPress={handleDismiss}>
              Dismiss
            </UiButton>
            <UiButton variant='primary' onPress={handleRetry}>
              Try again
            </UiButton>
          </div>
        </div>
      ) : (
        <div className='flex flex-col items-center gap-4 py-2 text-center'>
          <Spinner size='lg' />
          <p className='text-sm text-gray-500'>Enter your PIN on the Jade device to continue.</p>
        </div>
      )}
    </UiModal>
  )
}
