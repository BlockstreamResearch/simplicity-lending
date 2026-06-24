import { buttonVariants, Chip, Dropdown } from '@heroui/react'
import { useState } from 'react'

import { getTxExplorerUrl } from '@/api/esplora/utils'
import BellBoldIcon from '@/components/icons/BellBoldIcon'
import { UiButton } from '@/components/ui/UiButton'
import type { PendingTxRecord } from '@/providers/pendingTransactions/types'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'
import { getConfirmationProgressText, PENDING_TX_KIND_LABEL } from '@/utils/pendingTransactions'

function PendingTxRow({ tx }: { tx: PendingTxRecord }) {
  return (
    <div className='bg-surface-secondary flex flex-col gap-1 rounded-lg p-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{PENDING_TX_KIND_LABEL[tx.kind]}</span>
        <Chip
          size='sm'
          variant='soft'
          color={tx.confirmationStatus === 'failed' ? 'danger' : 'default'}
        >
          {getConfirmationProgressText(tx)}
        </Chip>
      </div>
      <a
        className='text-accent text-xs underline'
        href={getTxExplorerUrl(tx.txid)}
        target='_blank'
        rel='noopener noreferrer'
      >
        {truncateAddress(tx.txid)}
      </a>
    </div>
  )
}

export function BellNotificationButton() {
  const { connectionStatus, reconnecting, syncing, receiveAddress } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const [isOpen, setIsOpen] = useState(false)
  const activeCount = pendingTxs.filter(tx => tx.confirmationStatus !== 'failed').length

  const isTransitional =
    reconnecting || connectionStatus === 'locked' || (syncing && connectionStatus !== 'ready')
  const isReady = connectionStatus === 'ready' && Boolean(receiveAddress)

  if (!isReady && !isTransitional) return null

  if (isTransitional) {
    return (
      <UiButton variant='primary' isIconOnly isDisabled aria-label='Notifications'>
        <BellBoldIcon className='size-4' />
      </UiButton>
    )
  }

  return (
    <Dropdown.Root isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dropdown.Trigger
        aria-label='Notifications'
        className={buttonVariants({ variant: 'primary', isIconOnly: true })}
      >
        <span className='relative flex size-full items-center justify-center'>
          <BellBoldIcon className='size-4' />
          {activeCount > 0 && (
            <span
              className='bg-danger border-danger absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2'
              aria-hidden
            />
          )}
        </span>
      </Dropdown.Trigger>
      <Dropdown.Popover placement='bottom end' className='p-4'>
        <div className='flex w-80 flex-col gap-3'>
          <span className='text-sm font-semibold'>Notifications</span>
          {pendingTxs.length === 0 ? (
            <p className='text-muted text-sm'>No pending transactions.</p>
          ) : (
            pendingTxs.map(tx => <PendingTxRow key={tx.txid} tx={tx} />)
          )}
        </div>
      </Dropdown.Popover>
    </Dropdown.Root>
  )
}
