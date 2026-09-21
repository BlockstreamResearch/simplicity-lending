import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import CopyButton from '@/components/CopyButton'
import ChevronLeftIcon from '@/components/icons/ChevronLeftIcon'
import HumidIcon from '@/components/icons/HumidIcon'
import JadeIcon from '@/components/icons/JadeIcon'
import SeedIcon from '@/components/icons/SeedIcon'
import SideSwapIcon from '@/components/icons/SideSwapIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { MnemonicInput } from '@/components/MnemonicInput'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import type { WalletChoice } from '@/providers/walletFacade/types'
import { useWallet } from '@/providers/walletFacade/useWallet'

const MNEMONIC_WORD_COUNT = 12

interface WalletConnectModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * How each wallet looks, and nothing about what it does.
 *
 * Which wallets exist, which can be pressed and what each needs to start are all the facade's
 * answers, read from the list it publishes. This decides only what a person sees on the card, and
 * a wallet it has no art for still gets one.
 */
const PRESENTATION: Record<string, { icon: ReactNode; subtitle: string; badge?: ReactNode }> = {
  humid: {
    icon: <HumidIcon className='size-5 text-white' />,
    subtitle: 'Approve in the HUMID browser extension',
  },
  jade: {
    icon: <JadeIcon className='size-6' />,
    subtitle: 'Sign with your Jade hardware wallet over USB',
  },
  seed: {
    icon: <SeedIcon className='size-5 text-white' />,
    subtitle: 'Paste or generate a 12-word phrase — no hardware needed',
    badge: (
      <Chip color='warning' variant='soft' size='sm'>
        Demo only
      </Chip>
    ),
  },
  sideswap: {
    icon: <SideSwapIcon className='size-5' />,
    subtitle: 'Approve in the SideSwap wallet',
    badge: (
      <Chip color='warning' variant='soft' size='sm'>
        Experimental
      </Chip>
    ),
  },
}

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
 * Every card is one wallet the dapp can act through, and each says for itself whether it can be
 * pressed here and why not — an extension that is not installed, a browser with no port to a
 * device, a build carrying no relay or no demo wallet. None of those is a fact about this
 * project's progress, and no card says a wallet is coming.
 */
export function WalletConnectModal({ isOpen, onOpenChange }: WalletConnectModalProps) {
  const {
    connect,
    cancelPendingRequest,
    connectionStatus,
    wallets,
    pendingRequest,
    isError,
    error,
  } = useWallet()
  const [asking, setAsking] = useState<WalletChoice | null>(null)
  const [mnemonic, setMnemonic] = useState('')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(isOpen)

  // Opening returns to the cards, unless something is already waiting on the person elsewhere.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setAsking(null)
      setMnemonic('')
    }
  }

  // A device that is asking for its PIN has its own screen, and there is nothing left to pick.
  useEffect(() => {
    if (isOpen && (connectionStatus === 'ready' || connectionStatus === 'locked')) {
      onOpenChange(false)
    }
  }, [isOpen, connectionStatus, onOpenChange])

  const startConnecting = async (choice: WalletChoice, options?: { mnemonic?: string }) => {
    if (connectingId) return

    setConnectingId(choice.id)
    try {
      await connect(choice.id, options)
      // The phrase is the account. It is dropped the moment it has been used, rather than left in
      // this component until somebody opens the picker again.
      setMnemonic('')
    } catch {
      // Reported by the facade and read from `error` below, where the person is looking.
    } finally {
      setConnectingId(null)
    }
  }

  const handlePress = (choice: WalletChoice) => {
    if (choice.requiresRecoveryPhrase) {
      setAsking(choice)

      return
    }

    void startConnecting(choice)
  }

  const handleGiveUp = async () => {
    await cancelPendingRequest()
    setAsking(null)
  }

  const wordCount = mnemonic.split(/\s+/).filter(Boolean).length
  const visibleError = isError ? error : null
  const waitingLink = pendingRequest?.kind === 'login' ? pendingRequest.appLink : null

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-108'
      title={
        asking ? (
          <span className='flex items-center gap-1'>
            <button
              type='button'
              onClick={() => setAsking(null)}
              disabled={connectingId !== null}
              aria-label='Back'
              className='text-muted hover:text-foreground -ml-1.5 flex size-7 items-center justify-center rounded-full transition disabled:opacity-50'
            >
              <ChevronLeftIcon className='size-4' />
            </button>
            Connect with {asking.name}
          </span>
        ) : (
          'Connect Wallet'
        )
      }
    >
      {pendingRequest ? (
        <div className='flex flex-col gap-4'>
          <p className='text-muted text-sm'>
            Open this link in your wallet to approve the connection.
          </p>
          {waitingLink ? (
            <div className='bg-surface-secondary flex items-center justify-between gap-2 rounded-lg p-2 px-3'>
              <a
                href={waitingLink}
                className='text-accent truncate font-mono text-xs underline-offset-2 hover:underline'
              >
                {waitingLink}
              </a>
              <CopyButton value={waitingLink} aria-label='Copy connect link' />
            </div>
          ) : (
            <UiButton variant='secondary' fullWidth isDisabled isPending loadingText='Waiting…'>
              Waiting…
            </UiButton>
          )}
          {visibleError && <p className='text-danger text-sm'>{visibleError}</p>}
          <UiButton variant='secondary' fullWidth onPress={() => void handleGiveUp()}>
            Cancel
          </UiButton>
        </div>
      ) : asking ? (
        <div className='flex flex-col gap-4'>
          <div className='border-warning bg-warning/15 text-muted flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-medium'>
            <TriangleExclamationIcon className='text-warning size-6 shrink-0' />
            Demo only. Never enter a real wallet&apos;s recovery phrase here — use a fresh or
            generated one.
          </div>
          <MnemonicInput onChange={setMnemonic} />
          {visibleError && <p className='text-danger text-sm'>{visibleError}</p>}
          <UiButton
            variant='primary'
            fullWidth
            isPending={connectingId !== null}
            loadingText='Connecting…'
            isDisabled={wordCount !== MNEMONIC_WORD_COUNT}
            onPress={() => void startConnecting(asking, { mnemonic })}
          >
            Connect
          </UiButton>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {wallets.map(choice => {
            const shown = PRESENTATION[choice.id]

            return (
              <ConnectOptionCard
                key={choice.id}
                icon={shown?.icon ?? <SeedIcon className='size-5 text-white' />}
                iconBadgeClassName='bg-accent'
                title={choice.name}
                subtitle={choice.unavailableReason ?? shown?.subtitle ?? ''}
                badge={shown?.badge}
                disabled={connectingId !== null || !choice.isAvailable}
                onPress={() => handlePress(choice)}
              />
            )
          })}
          {visibleError && <p className='text-danger text-sm'>{visibleError}</p>}
        </div>
      )}
    </UiModal>
  )
}
