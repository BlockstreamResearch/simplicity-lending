import { Spinner } from '@heroui/react'
import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { useWallet } from '@/providers/wallet/useWallet'

export function JadeUnlockModal() {
  const { connectionStatus, isJade, walletType, error, isError, connect } = useWallet()
  const [prevConnectionStatus, setPrevConnectionStatus] = useState(connectionStatus)
  const [awaitingPin, setAwaitingPin] = useState(false)
  const [retrying, setRetrying] = useState(false)

  if (connectionStatus !== prevConnectionStatus) {
    setPrevConnectionStatus(connectionStatus)
    if (connectionStatus === 'locked' && isJade) setAwaitingPin(true)
    else if (connectionStatus === 'ready') setAwaitingPin(false)
  }

  // Stay open across a retry — only swap the inner content — instead of closing and
  // reopening, which played the modal's exit/enter transition back to back and read as
  // a flicker/reload.
  const failed = awaitingPin && isError && connectionStatus !== 'locked' && !retrying

  const handleDismiss = () => setAwaitingPin(false)

  const handleRetry = () => {
    setRetrying(true)
    connect(walletType ?? DEFAULT_WALLET_TYPE)
      .catch(console.warn)
      .finally(() => setRetrying(false))
  }

  return (
    <UiModal
      isOpen={awaitingPin}
      onOpenChange={() => {}}
      isDismissable={false}
      showCloseButton={false}
      title={failed ? 'Unlock failed' : 'Unlock your Jade'}
    >
      {failed ? (
        <div className='flex flex-col items-center gap-4 py-2 text-center'>
          <p className='text-danger text-sm'>{error}</p>
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
