import { buttonVariants, Chip, Dropdown } from '@heroui/react'
import { useState } from 'react'

import CheckIcon from '@/components/icons/CheckIcon'
import CopyIcon from '@/components/icons/CopyIcon'
import { UiButton } from '@/components/ui/UiButton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'

import { JadeUnlockModal } from './JadeUnlockModal'

const NETWORK_LABEL: Record<'liquidtestnet' | 'regtest', string> = {
  liquidtestnet: 'Testnet',
  regtest: 'Regtest',
}

export function WalletButton({ isDisabled }: { isDisabled?: boolean } = {}) {
  const { connectionStatus, syncing, receiveAddress, connect, disconnect, reconnecting } =
    useWallet()
  const { network, isMainnet } = useLwk()
  const [disconnecting, setDisconnecting] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [copied, copyToClipboard] = useCopyToClipboard()

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
                <div className='flex flex-col gap-3'>
                  {!isMainnet && (
                    <Chip color='warning' variant='soft' size='sm' className='self-start'>
                      {NETWORK_LABEL[network as 'liquidtestnet' | 'regtest']}
                    </Chip>
                  )}
                  <div className='bg-surface-secondary flex items-center justify-between gap-2 rounded-lg p-1 px-2'>
                    <span className='font-mono text-xs'>{truncateAddress(receiveAddress)}</span>
                    <UiButton
                      variant='ghost'
                      isIconOnly
                      size='sm'
                      aria-label='Copy address'
                      onPress={() => copyToClipboard(receiveAddress)}
                    >
                      {copied ? <CheckIcon className='size-4' /> : <CopyIcon className='size-4' />}
                    </UiButton>
                  </div>
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
