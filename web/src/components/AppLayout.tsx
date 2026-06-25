import { buttonVariants } from '@heroui/react'
import { Link, Outlet } from 'react-router-dom'

import { BellNotificationButton } from '@/components/BellNotificationButton'
import ArrowSquareOutIcon from '@/components/icons/ArrowSquareOutIcon'
import { JadeUnlockModal } from '@/components/JadeUnlockModal'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { WalletButton } from '@/components/WalletButton'
import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'
import { useOfferModal } from '@/hooks/useOfferModal'

const ABOUT_SIMPLICITY_URL = 'https://github.com/BlockstreamResearch/simplicity'

const NAV = [
  { to: RoutePath.Dashboard, label: 'Dashboard' },
  { to: RoutePath.Borrow, label: 'Borrow' },
  { to: RoutePath.Supply, label: 'Supply' },
  ...(env.DEV
    ? [
        { to: RoutePath.DesignSystem, label: 'System' },
        { to: RoutePath.Demo, label: 'Demo' },
      ]
    : []),
]

export default function AppLayout() {
  const { close, isOpen, lastOffer } = useOfferModal()
  return (
    <main className='bg-surface text-foreground min-h-screen'>
      <div className='mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-6 pb-12 sm:px-8 lg:gap-10 lg:px-20 lg:pt-10 lg:pb-20'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <Link to={RoutePath.Dashboard} className='flex flex-col gap-1.5'>
            <h1 className='text-3xl leading-none font-black tracking-tight uppercase sm:text-4xl lg:text-[43px] lg:leading-10'>
              Lending
            </h1>
            <span className='text-foreground text-xs font-medium tracking-[0.16em] uppercase'>
              powered by Simplicity
            </span>
          </Link>

          <div className='flex flex-wrap items-center gap-3'>
            <a
              className={buttonVariants({ variant: 'ghost' })}
              href={ABOUT_SIMPLICITY_URL}
              target='_blank'
              rel='noopener noreferrer'
            >
              About Simplicity
              <ArrowSquareOutIcon className='size-4' />
            </a>
            <BellNotificationButton />
            <WalletButton />
          </div>
        </header>

        <OfferActionModal offer={lastOffer} isOpen={isOpen} onClose={close} onSuccess={close} />
        <Outlet />
        <JadeUnlockModal />

        <footer className='text-muted flex flex-col gap-3 text-xs'>
          <nav className='flex flex-wrap items-center gap-4 font-medium'>
            {NAV.map(({ to, label }) => (
              <Link key={to} className='text-accent hover:underline' to={to}>
                {label}
              </Link>
            ))}
          </nav>
          <div>
            <p>Network: {env.VITE_NETWORK}</p>
            <p>API URL: {env.VITE_API_URL}</p>
            <p>Esplora Base URL: {env.VITE_ESPLORA_BASE_URL}</p>
          </div>
        </footer>
      </div>
    </main>
  )
}
