import { Link, Outlet } from 'react-router-dom'

import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'

export default function AppLayout() {
  return (
    <main className='min-h-screen'>
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8'>
        <header className='flex justify-between items-center'>
          <h1 className='text-4xl font-black uppercase'>Lending</h1>
          <nav className='flex flex-wrap items-center gap-6 text-sm font-medium'>
            <Link className='text-accent hover:underline' to={RoutePath.Dashboard}>
              Dashboard
            </Link>
            <Link className='text-accent hover:underline' to={RoutePath.Borrow}>
              Borrow
            </Link>
            <Link className='text-accent hover:underline' to={RoutePath.Supply}>
              Supply
            </Link>
          </nav>
        </header>

        <section className='rounded-2xl border bg-white p-6 shadow-sm'>
          <Outlet />
        </section>

        <footer className='text-sm'>
          <p>Network: {env.VITE_NETWORK}</p>
          <p>API URL: {env.VITE_API_URL}</p>
          <p>Esplora Base URL: {env.VITE_ESPLORA_BASE_URL}</p>
        </footer>
      </div>
    </main>
  )
}
