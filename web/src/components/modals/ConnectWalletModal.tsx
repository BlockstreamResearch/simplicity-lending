import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import CopyButton from '@/components/CopyButton'
import ChevronLeftIcon from '@/components/icons/ChevronLeftIcon'
import JadeIcon from '@/components/icons/JadeIcon'
import SeedIcon from '@/components/icons/SeedIcon'
import SideSwapIcon from '@/components/icons/SideSwapIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { MnemonicInput } from '@/components/MnemonicInput'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { env } from '@/constants/env'
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

export function ConnectWalletModal({ isOpen, onOpenChange }: ConnectWalletModalProps) {
  const { connect, cancelPendingRequest, connectionStatus, pendingRequest, isError, error } =
    useWallet()
  const [mode, setMode] = useState<'choose' | 'seed' | 'sideswap'>('choose')
  const [mnemonic, setMnemonic] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [jadeConnecting, setJadeConnecting] = useState(false)
  const [sideswapConnecting, setSideswapConnecting] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)

  // Reset to the picker on open, unless a SideSwap login is still pending.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setMode(pendingRequest?.kind === 'login' ? 'sideswap' : 'choose')
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

  const handleJadeConnect = async () => {
    if (jadeConnecting) return

    setJadeConnecting(true)
    onOpenChange(false)
    try {
      await connect(DEFAULT_WALLET_TYPE)
    } finally {
      setJadeConnecting(false)
    }
  }

  const handleSeedConnect = async () => {
    setConnecting(true)
    try {
      await connect(DEFAULT_WALLET_TYPE, { seedMnemonic: mnemonic })
    } finally {
      setConnecting(false)
    }
  }

  const handleSideswapConnect = async () => {
    setMode('sideswap')
    setSideswapConnecting(true)
    try {
      await connect(DEFAULT_WALLET_TYPE, { sideswap: true })
    } finally {
      setSideswapConnecting(false)
    }
  }

  const handleSideswapCancel = async () => {
    await cancelPendingRequest()
    setMode('choose')
  }

  const wordCount = mnemonic.split(/\s+/).filter(Boolean).length
  const canConnect = wordCount === MNEMONIC_WORD_COUNT
  const visibleError = isError ? error : null
  const loginLink = pendingRequest?.kind === 'login' ? pendingRequest.appLink : null

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
        ) : mode === 'sideswap' ? (
          <span className='flex items-center gap-1'>
            <button
              type='button'
              onClick={() => void handleSideswapCancel()}
              aria-label='Back'
              className='text-muted hover:text-foreground -ml-1.5 flex size-7 items-center justify-center rounded-full transition disabled:opacity-50'
            >
              <ChevronLeftIcon className='size-4' />
            </button>
            Connect with SideSwap
          </span>
        ) : (
          'Connect Wallet'
        )
      }
    >
      {mode === 'choose' ? (
        <div className='flex flex-col gap-3'>
          <ConnectOptionCard
            icon={<JadeIcon className='size-6' />}
            iconBadgeClassName='bg-accent'
            title='Jade (testnet)'
            subtitle='Sign with your Jade hardware wallet over USB'
            disabled={jadeConnecting}
            onPress={() => void handleJadeConnect()}
          />
          <ConnectOptionCard
            icon={<SeedIcon className='size-5 text-white' />}
            iconBadgeClassName='bg-accent'
            title='Seed phrase'
            subtitle='Paste or generate a 12-word phrase — no hardware needed'
            badge={
              <Chip color='warning' variant='soft' size='sm'>
                Demo only
              </Chip>
            }
            onPress={() => setMode('seed')}
          />
          {env.VITE_SIDESWAP_WS_URL && (
            <ConnectOptionCard
              icon={<SideSwapIcon className='size-5' />}
              iconBadgeClassName='bg-accent'
              title='SideSwap'
              subtitle='Connect SideSwap desktop app'
              badge={
                <Chip color='warning' variant='soft' size='sm'>
                  Experimental
                </Chip>
              }
              disabled={sideswapConnecting}
              onPress={() => void handleSideswapConnect()}
            />
          )}
        </div>
      ) : mode === 'seed' ? (
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
            isPending={connecting}
            loadingText='Connecting…'
            isDisabled={!canConnect}
            onPress={() => void handleSeedConnect()}
          >
            Connect
          </UiButton>
        </div>
      ) : (
        <div className='flex flex-col gap-4'>
          <p className='text-muted text-sm'>
            Open this link in a SideSwap testnet dev build to approve the connection.
          </p>
          {loginLink ? (
            <div className='bg-surface-secondary flex items-center justify-between gap-2 rounded-lg p-2 px-3'>
              <a
                href={loginLink}
                className='text-accent truncate font-mono text-xs underline-offset-2 hover:underline'
              >
                {loginLink}
              </a>
              <CopyButton value={loginLink} aria-label='Copy connect link' />
            </div>
          ) : (
            <UiButton variant='secondary' fullWidth isDisabled isPending loadingText='Connecting…'>
              Connecting…
            </UiButton>
          )}
          {visibleError && <p className='text-danger text-sm'>{visibleError}</p>}
          <UiButton variant='secondary' fullWidth onPress={() => void handleSideswapCancel()}>
            Cancel
          </UiButton>
        </div>
      )}
    </UiModal>
  )
}
