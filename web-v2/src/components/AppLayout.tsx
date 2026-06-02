import { Link, Outlet } from 'react-router-dom'

import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'

const NAV = [
  { to: RoutePath.Dashboard, label: 'Dashboard' },
  { to: RoutePath.Borrow, label: 'Borrow' },
  { to: RoutePath.Supply, label: 'Supply' },
  ...(env.DEV ? [{ to: RoutePath.DesignSystem, label: 'System' }] : []),
]

export default function AppLayout() {
  return (
    <main className='bg-background text-foreground min-h-screen'>
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8'>
        <header className='flex items-center justify-between'>
          <h1 className='text-h2'>Lending</h1>
          <nav className='flex flex-wrap items-center gap-6 text-sm font-medium'>
            {NAV.map(({ to, label }) => (
              <Link key={to} className='text-accent hover:underline' to={to}>
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <Outlet />

        <footer className='text-muted text-xs'>
          <p>Network: {env.VITE_NETWORK}</p>
          <p>API URL: {env.VITE_API_URL}</p>
          <p>Esplora Base URL: {env.VITE_ESPLORA_BASE_URL}</p>
        </footer>
      </div>
    </main>
  )
}
