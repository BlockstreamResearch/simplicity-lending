import { useCallback } from 'react'
import { Link, Outlet } from 'react-router-dom'

import ArrowSquareOutIcon from '@/components/icons/ArrowSquareOutIcon'
import BellIcon from '@/components/icons/BellIcon'
import { UiButton } from '@/components/ui/UiButton'
import { WalletButton } from '@/components/WalletButton'
import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'

const ABOUT_SIMPLICITY_URL = 'https://github.com/BlockstreamResearch/simplicity'

const NAV = [
  { to: RoutePath.Dashboard, label: 'Dashboard' },
  { to: RoutePath.Borrow, label: 'Borrow' },
  { to: RoutePath.Supply, label: 'Supply' },
  ...(env.DEV
    ? [
        { to: RoutePath.DesignSystem, label: 'System' },
        { to: RoutePath.WalletDemo, label: 'Wallet Demo' },
        { to: RoutePath.Demo, label: 'Demo' },
      ]
    : []),
]

export default function AppLayout() {
  const openAbout = useCallback(() => {
    window.open(ABOUT_SIMPLICITY_URL, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <main className='bg-surface text-foreground min-h-screen'>
      <div className='mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 pt-6 pb-12 sm:px-8 lg:gap-10 lg:px-20 lg:pt-10 lg:pb-20'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <Link to={RoutePath.Dashboard} className='flex flex-col gap-1.5'>
            <span className='text-3xl leading-none font-black tracking-tight uppercase sm:text-4xl lg:text-[43px] lg:leading-[40px]'>
              Lending
            </span>
            <span className='text-foreground text-xs font-medium tracking-[0.16em] uppercase'>
              powered by Simplicity
            </span>
          </Link>

          <div className='flex flex-wrap items-center gap-3'>
            <UiButton variant='ghost' onPress={openAbout}>
              About Simplicity
              <ArrowSquareOutIcon className='size-4' />
            </UiButton>
            {/* Notifications not wired yet — disabled placeholder. */}
            <UiButton variant='primary' isIconOnly isDisabled aria-label='Notifications'>
              <BellIcon className='size-5' />
            </UiButton>
            <WalletButton />
          </div>
        </header>

        <Outlet />

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
