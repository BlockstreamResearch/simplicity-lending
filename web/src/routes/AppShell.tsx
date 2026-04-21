import { NavLink, Outlet } from 'react-router-dom'
import { AccountMenu } from '../components/AccountMenu'
import { useWalletAbiSession } from '../walletAbi/session'

function navClassName({ isActive }: { isActive: boolean }) {
  return [
    'rounded-full px-3 py-2 text-sm font-medium transition sm:px-4',
    isActive
      ? 'bg-neutral-950 text-white'
      : 'text-neutral-600 hover:bg-neutral-100',
  ].join(' ')
}

export function AppShell() {
  const session = useWalletAbiSession()
  const faucetUrl = import.meta.env.VITE_FAUCET_URL?.trim()

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f8f4ec_0%,#fdfdfb_45%,#f3f7f5_100%)] text-neutral-950">
      <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-neutral-500">
                Simplicity Lending
              </p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950 sm:text-2xl">
                <span className="sm:hidden">Wallet ABI</span>
                <span className="hidden sm:inline">WalletConnect Wallet ABI</span>
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {faucetUrl ? (
                <a
                  href={faucetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:inline-flex"
                >
                  Faucet
                </a>
              ) : null}
              <AccountMenu
                status={session.status}
                address={session.receiveAddress}
                error={session.error}
                onConnect={session.connect}
                onDisconnect={session.disconnect}
                onRefresh={session.refreshIdentity}
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto pb-1">
            <nav className="inline-flex min-w-max items-center gap-2 rounded-full border border-neutral-200 bg-white p-1">
              <NavLink to="/dashboard" className={navClassName}>
                Dashboard
              </NavLink>
              <NavLink to="/borrower" className={navClassName}>
                Borrower
              </NavLink>
              <NavLink to="/lender" className={navClassName}>
                Lender
              </NavLink>
              <NavLink to="/utility" className={navClassName}>
                Utility
              </NavLink>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
