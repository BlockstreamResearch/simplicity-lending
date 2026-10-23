import { buttonVariants } from '@heroui/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import humidIconUrl from '@/assets/wallets/humid.svg'
import sideswapIconUrl from '@/assets/wallets/sideswap.png'
import CopyButton from '@/components/CopyButton'
import ArrowSquareOutIcon from '@/components/icons/ArrowSquareOutIcon'
import ChevronLeftIcon from '@/components/icons/ChevronLeftIcon'
import JadeIcon from '@/components/icons/JadeIcon'
import SeedIcon from '@/components/icons/SeedIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { MnemonicInput } from '@/components/MnemonicInput'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { env } from '@/constants/env'
import { ExternalLink } from '@/constants/links'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { useWallet } from '@/providers/wallet/useWallet'

const MNEMONIC_WORD_COUNT = 12

interface ConnectWalletModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

type WalletTagTone = 'success' | 'warning' | 'neutral'

const WALLET_TAG_TONE_CLASS: Record<WalletTagTone, string> = {
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  neutral: 'bg-default text-muted',
}

function WalletOption({
  icon,
  name,
  tag,
  disabled = false,
  onPress,
}: {
  icon: ReactNode
  name: string
  tag?: { label: string; tone: WalletTagTone }
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onPress}
      className='bg-surface-secondary hover:bg-surface-tertiary flex h-14 w-full items-center gap-3 rounded-2xl p-2 pr-4 text-left transition active:scale-[0.99] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-surface-secondary'
    >
      <span className='relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl after:absolute after:inset-0 after:rounded-xl after:ring-1 after:ring-black/10 after:ring-inset'>
        {icon}
      </span>
      <span className='text-foreground min-w-0 flex-1 truncate text-base font-medium'>{name}</span>
      {tag && (
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] leading-3 font-bold tracking-wide uppercase ${WALLET_TAG_TONE_CLASS[tag.tone]}`}
        >
          {tag.label}
        </span>
      )}
    </button>
  )
}

function ModalTitle({
  children,
  onBack,
  backDisabled,
}: {
  children: ReactNode
  onBack?: () => void
  backDisabled?: boolean
}) {
  return (
    <span className='relative flex min-h-7 items-center justify-center text-center'>
      {onBack && (
        <button
          type='button'
          onClick={onBack}
          disabled={backDisabled}
          aria-label='Back'
          className='text-muted hover:text-foreground absolute -left-2 flex size-7 items-center justify-center rounded-full transition disabled:opacity-50'
        >
          <ChevronLeftIcon className='size-4' />
        </button>
      )}
      {children}
    </span>
  )
}

export function ConnectWalletModal({ isOpen, onOpenChange }: ConnectWalletModalProps) {
  const { connect, cancelPendingRequest, connectionStatus, pendingRequest, isError, error } =
    useWallet()
  const [mode, setMode] = useState<'choose' | 'seed' | 'sideswap' | 'humid-install'>('choose')
  const [mnemonic, setMnemonic] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [jadeConnecting, setJadeConnecting] = useState(false)
  const [sideswapConnecting, setSideswapConnecting] = useState(false)
  const [humidConnecting, setHumidConnecting] = useState(false)
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

  const handleHumidConnect = async () => {
    if (humidConnecting) return

    setHumidConnecting(true)
    try {
      await connect(DEFAULT_WALLET_TYPE, { humid: true })
    } finally {
      setHumidConnecting(false)
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
  const humidInstalled = Boolean(window.humid)

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      dialogClassName='max-w-90'
      title={
        mode === 'seed' ? (
          <ModalTitle onBack={() => setMode('choose')} backDisabled={connecting}>
            Connect with Seed Phrase
          </ModalTitle>
        ) : mode === 'sideswap' ? (
          <ModalTitle onBack={() => void handleSideswapCancel()}>Connect with SideSwap</ModalTitle>
        ) : mode === 'humid-install' ? (
          <ModalTitle onBack={() => setMode('choose')}>Get Humid</ModalTitle>
        ) : (
          <ModalTitle>Connect Wallet</ModalTitle>
        )
      }
    >
      {mode === 'choose' ? (
        <div className='flex flex-col gap-2'>
          <WalletOption
            icon={<img src={humidIconUrl} alt='' className='size-full' />}
            name='Humid'
            tag={
              humidInstalled
                ? { label: 'Installed', tone: 'success' }
                : { label: 'Experimental', tone: 'warning' }
            }
            disabled={humidConnecting}
            onPress={() => (humidInstalled ? void handleHumidConnect() : setMode('humid-install'))}
          />
          <WalletOption
            icon={
              <span className='flex size-full items-center justify-center bg-[#00B093]'>
                <JadeIcon className='size-6' />
              </span>
            }
            name='Jade'
            tag={{ label: 'Testnet', tone: 'neutral' }}
            disabled={jadeConnecting}
            onPress={() => void handleJadeConnect()}
          />
          {env.VITE_SIDESWAP_WS_URL && (
            <WalletOption
              icon={<img src={sideswapIconUrl} alt='' className='size-full' />}
              name='SideSwap'
              tag={{ label: 'Experimental', tone: 'warning' }}
              disabled={sideswapConnecting}
              onPress={() => void handleSideswapConnect()}
            />
          )}
          {env.VITE_DEMO_MODE && (
            <WalletOption
              icon={
                <span className='bg-default flex size-full items-center justify-center'>
                  <SeedIcon className='text-foreground size-5' />
                </span>
              }
              name='Seed phrase'
              tag={{ label: 'Demo only', tone: 'warning' }}
              onPress={() => setMode('seed')}
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
      ) : mode === 'humid-install' ? (
        <div className='flex flex-col items-center gap-4 text-center'>
          <img src={humidIconUrl} alt='' className='size-16 rounded-2xl' />
          <div className='flex flex-col gap-1'>
            <p className='text-foreground text-base font-medium'>Humid isn&apos;t installed</p>
            <p className='text-muted text-sm'>
              Download the latest release from GitHub, unzip it and add it with Load unpacked in
              chrome://extensions (Developer mode on). Then reload this page.
            </p>
          </div>
          <div className='flex w-full flex-col gap-2'>
            <a
              className={buttonVariants({ variant: 'primary', fullWidth: true })}
              href={ExternalLink.HumidReleases}
              target='_blank'
              rel='noopener noreferrer'
            >
              Download from GitHub
              <ArrowSquareOutIcon className='size-4' />
            </a>
            <UiButton variant='secondary' fullWidth onPress={() => window.location.reload()}>
              I&apos;ve installed it
            </UiButton>
          </div>
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
