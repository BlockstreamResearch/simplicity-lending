import { buttonVariants, Dropdown } from '@heroui/react'
import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'

import { JadeUnlockModal } from './JadeUnlockModal'

export function WalletButton({ isDisabled }: { isDisabled?: boolean } = {}) {
  const { connectionStatus, syncing, receiveAddress, connect, disconnect, reconnecting } =
    useWallet()
  const [disconnecting, setDisconnecting] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await disconnect()
    } finally {
      setDisconnecting(false)
      setIsMenuOpen(false)
    }
  }

  return (
    <>
      {(() => {
        if (reconnecting) {
          return (
            <UiButton variant='secondary' isDisabled>
              Reconnecting…
            </UiButton>
          )
        }

        if (connectionStatus === 'locked') {
          return (
            <UiButton variant='secondary' isDisabled>
              Enter PIN on device
            </UiButton>
          )
        }

        if (syncing && connectionStatus !== 'ready') {
          return (
            <UiButton variant='secondary' isDisabled isPending loadingText='Connecting…'>
              Connecting…
            </UiButton>
          )
        }

        if (connectionStatus === 'ready' && receiveAddress) {
          return (
            <Dropdown.Root isOpen={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <Dropdown.Trigger className={buttonVariants({ variant: 'secondary' })}>
                {truncateAddress(receiveAddress)}
              </Dropdown.Trigger>
              <Dropdown.Popover placement='bottom end' className='p-4'>
                <div>
                  <UiButton
                    variant='danger'
                    fullWidth
                    className='rounded-lg'
                    isPending={disconnecting}
                    loadingText='Disconnecting…'
                    onPress={handleDisconnect}
                  >
                    Disconnect
                  </UiButton>
                </div>
              </Dropdown.Popover>
            </Dropdown.Root>
          )
        }

        return (
          <UiButton
            variant='primary'
            isDisabled={isDisabled}
            onPress={() => connect(DEFAULT_WALLET_TYPE)}
          >
            Connect Wallet
          </UiButton>
        )
      })()}
      <JadeUnlockModal />
    </>
  )
}
