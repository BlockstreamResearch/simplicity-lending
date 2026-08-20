import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import HumidIcon from '@/components/icons/HumidIcon'
import JadeIcon from '@/components/icons/JadeIcon'
import SeedIcon from '@/components/icons/SeedIcon'
import SideSwapIcon from '@/components/icons/SideSwapIcon'
import { UiModal } from '@/components/ui/UiModal'
import { useWallet } from '@/providers/walletFacade/useWallet'

interface WalletConnectModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/** Why a wallet whose connector is still in the tree cannot be picked yet. */
const AWAITING_ADAPTER = 'Reconnecting through the new wallet layer'

function ConnectOptionCard({
  icon,
  title,
  subtitle,
  badge,
  disabled = false,
  iconBadgeClassName,
  onPress,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  badge?: ReactNode
  disabled?: boolean
  iconBadgeClassName: string
  onPress: () => void
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onPress}
      className='border-separator bg-surface-secondary hover:border-accent hover:bg-accent-soft/40 group flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-default disabled:opacity-60 disabled:hover:border-separator disabled:hover:bg-surface-secondary'
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-full transition group-disabled:opacity-70 ${iconBadgeClassName}`}
      >
        {icon}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-semibold'>{title}</span>
          {badge}
        </div>
        <p className='text-muted text-xs'>{subtitle}</p>
      </div>
    </button>
  )
}

/**
 * Which wallet to act through.
 *
 * One wallet can be picked today. The others keep their card, disabled and saying why, because
 * their connectors are still here and each is coming back as an adapter behind the same seam —
 * a card that vanished would read as a wallet the dapp dropped.
 */
export function WalletConnectModal({ isOpen, onOpenChange }: WalletConnectModalProps) {
  const { connect, connectionStatus, hasWallet, walletUnavailableReason, isError, error } =
    useWallet()
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (isOpen && connectionStatus === 'ready') onOpenChange(false)
  }, [isOpen, connectionStatus, onOpenChange])

  // The wallet asks for approval in its own window, which draws over this one. Step out of the
  // way first: a refusal is reported where the person is already looking.
  const handleConnect = async () => {
    if (connecting) return

    setConnecting(true)
    onOpenChange(false)
    try {
      await connect()
    } catch {
      // Reported by the facade and read from `error` below.
    } finally {
      setConnecting(false)
    }
  }

  const visibleError = isError ? error : null

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-108'
      title='Connect Wallet'
    >
      <div className='flex flex-col gap-3'>
        <ConnectOptionCard
          icon={<HumidIcon className='size-5 text-white' />}
          iconBadgeClassName='bg-accent'
          title='HUMID'
          subtitle={
            hasWallet
              ? 'Approve in the HUMID browser extension'
              : (walletUnavailableReason ?? 'Browser extension — not detected on this page')
          }
          disabled={connecting || !hasWallet}
          onPress={() => void handleConnect()}
        />
        <ConnectOptionCard
          icon={<JadeIcon className='size-6' />}
          iconBadgeClassName='bg-accent'
          title='Jade'
          subtitle={AWAITING_ADAPTER}
          disabled
          onPress={() => {}}
        />
        <ConnectOptionCard
          icon={<SeedIcon className='size-5 text-white' />}
          iconBadgeClassName='bg-accent'
          title='Seed phrase'
          subtitle={AWAITING_ADAPTER}
          badge={
            <Chip color='warning' variant='soft' size='sm'>
              Demo only
            </Chip>
          }
          disabled
          onPress={() => {}}
        />
        <ConnectOptionCard
          icon={<SideSwapIcon className='size-5' />}
          iconBadgeClassName='bg-accent'
          title='SideSwap'
          subtitle={AWAITING_ADAPTER}
          badge={
            <Chip color='warning' variant='soft' size='sm'>
              Experimental
            </Chip>
          }
          disabled
          onPress={() => {}}
        />
        {visibleError && <p className='text-danger text-sm'>{visibleError}</p>}
      </div>
    </UiModal>
  )
}
