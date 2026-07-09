import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import ChevronLeftIcon from '@/components/icons/ChevronLeftIcon'
import FileTextIcon from '@/components/icons/FileTextIcon'
import LockIcon from '@/components/icons/LockIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { MnemonicInput } from '@/components/MnemonicInput'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { useWallet } from '@/providers/wallet/useWallet'

const MNEMONIC_WORD_COUNT = 12

interface ConnectWalletModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

function ConnectOptionCard({
  icon,
  title,
  subtitle,
  badge,
  onPress,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  badge?: ReactNode
  onPress: () => void
}) {
  return (
    <button
      type='button'
      onClick={onPress}
      className='border-separator bg-surface-secondary hover:border-accent hover:bg-accent-soft/40 group flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition'
    >
      <span className='bg-accent-soft text-accent-soft-foreground group-hover:bg-accent group-hover:text-accent-foreground flex size-11 shrink-0 items-center justify-center rounded-full transition'>
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

export function ConnectWalletModal({ isOpen, onOpenChange }: ConnectWalletModalProps) {
  const { connect, connectionStatus, isError, error } = useWallet()
  const [mode, setMode] = useState<'choose' | 'seed'>('choose')
  const [mnemonic, setMnemonic] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)

  // Reset back to the picker each time the modal opens — derived during render (not an
  // effect) so it can't cause an extra flash of stale state before the reset commits.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setMode('choose')
      setMnemonic('')
    }
  }

  // Jade goes through its own locked/PIN handling elsewhere — once connect() kicks off,
  // this picker has nothing left to do. Seed connects straight to 'ready' or fails in place.
  useEffect(() => {
    if (isOpen && (connectionStatus === 'ready' || connectionStatus === 'locked')) {
      onOpenChange(false)
    }
  }, [isOpen, connectionStatus, onOpenChange])

  const handleJadeConnect = () => {
    onOpenChange(false)
    void connect(DEFAULT_WALLET_TYPE)
  }

  const handleSeedConnect = async () => {
    setConnecting(true)
    try {
      await connect(DEFAULT_WALLET_TYPE, mnemonic)
    } finally {
      setConnecting(false)
    }
  }

  const wordCount = mnemonic.split(/\s+/).filter(Boolean).length
  const canConnect = wordCount === MNEMONIC_WORD_COUNT

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-108'
      title={
        mode === 'seed' ? (
          <span className='flex items-center gap-1'>
            <button
              type='button'
              onClick={() => setMode('choose')}
              disabled={connecting}
              aria-label='Back'
              className='text-muted hover:text-foreground -ml-1.5 flex size-7 items-center justify-center rounded-full transition disabled:opacity-50'
            >
              <ChevronLeftIcon className='size-4' />
            </button>
            Connect with Seed Phrase
          </span>
        ) : (
          'Connect Wallet'
        )
      }
    >
      {mode === 'choose' ? (
        <div className='flex flex-col gap-3'>
          <ConnectOptionCard
            icon={<LockIcon className='size-5' />}
            title='Jade (testnet)'
            subtitle='Sign with your Jade hardware wallet over USB'
            onPress={handleJadeConnect}
          />
          <ConnectOptionCard
            icon={<FileTextIcon className='size-5' />}
            title='Seed phrase'
            subtitle='Paste or generate a 12-word phrase — no hardware needed'
            badge={
              <Chip color='warning' variant='soft' size='sm'>
                Demo only
              </Chip>
            }
            onPress={() => setMode('seed')}
          />
        </div>
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='border-warning bg-warning/15 text-muted flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-medium'>
            <TriangleExclamationIcon className='text-warning size-6 shrink-0' />
            Demo only. Never enter a real wallet&apos;s recovery phrase here — use a fresh or
            generated one.
          </div>
          <MnemonicInput onChange={setMnemonic} />
          {isError && error && <p className='text-danger text-sm'>{error}</p>}
          <UiButton
            variant='primary'
            fullWidth
            isPending={connecting}
            loadingText='Connecting…'
            isDisabled={!canConnect}
            onPress={() => void handleSeedConnect()}
          >
            Connect
          </UiButton>
        </div>
      )}
    </UiModal>
  )
}
