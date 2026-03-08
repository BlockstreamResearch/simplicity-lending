import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Dashboard } from './pages/Dashboard'
import { BorrowerPage } from './pages/Borrower'
import { LenderPage } from './pages/Lender'
import { UtilityPage } from './pages/Utility'
import { WalletAbiSessionProvider, useWalletAbiSession } from './walletAbi/WalletAbiSessionContext'
import { WalletConnectCard } from './walletAbi/WalletConnectCard'

export type Tab = 'dashboard' | 'borrower' | 'lender' | 'utility'

function tabFromHash(hash: string): Tab {
  const normalized = hash.replace(/^#\/?/, '').trim().toLowerCase()
  switch (normalized) {
    case 'borrower':
      return 'borrower'
    case 'lender':
      return 'lender'
    case 'utility':
      return 'utility'
    case 'dashboard':
    default:
      return 'dashboard'
  }
}

function hashForTab(tab: Tab): string {
  return `#/${tab}`
}

function shortId(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function WalletSessionMenu() {
  const { signingXOnlyPubkey, network, disconnect } = useWalletAbiSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!signingXOnlyPubkey) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        {shortId(signingXOnlyPubkey)}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-3 w-72 rounded-[1.5rem] border border-neutral-200 bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
            Wallet Session
          </p>
          <p className="mt-3 text-sm text-neutral-600">Network: {network ?? 'unknown'}</p>
          <p className="mt-2 break-all font-mono text-xs text-neutral-800">{signingXOnlyPubkey}</p>
          <button
            type="button"
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
              setOpen(false)
              void disconnect()
            }}
            className="mt-4 w-full rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}

function AppShell() {
  const { status, network, signerScriptPubkeyHex, signingXOnlyPubkey } = useWalletAbiSession()
  const [tab, setTab] = useState<Tab>(() => tabFromHash(window.location.hash))
  const connected = status === 'connected' && network && signerScriptPubkeyHex && signingXOnlyPubkey

  useEffect(() => {
    const onHashChange = () => {
      setTab(tabFromHash(window.location.hash))
    }

    window.addEventListener('hashchange', onHashChange)
    onHashChange()
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const nextHash = hashForTab(tab)
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [tab])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f8f4ec_0%,#fdfdfb_45%,#f3f7f5_100%)] text-neutral-950">
      <header className="border-b border-neutral-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-neutral-500">
              Simplicity Lending
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
              WalletConnect Wallet ABI
            </h1>
          </div>
          {connected ? (
            <div className="flex items-center gap-4">
              <nav className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white p-1">
                {(['dashboard', 'borrower', 'lender', 'utility'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={
                      tab === item
                        ? 'rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white'
                        : 'rounded-full px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100'
                    }
                  >
                    {item === 'dashboard'
                      ? 'Dashboard'
                      : item === 'borrower'
                        ? 'Borrower'
                        : item === 'lender'
                          ? 'Lender'
                          : 'Utility'}
                  </button>
                ))}
              </nav>
              <WalletSessionMenu />
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {!connected ? (
          <WalletConnectCard />
        ) : tab === 'dashboard' ? (
          <Dashboard
            onTab={setTab}
            network={network}
            signerScriptPubkeyHex={signerScriptPubkeyHex}
            signingXOnlyPubkey={signingXOnlyPubkey}
          />
        ) : tab === 'borrower' ? (
          <BorrowerPage />
        ) : tab === 'utility' ? (
          <UtilityPage />
        ) : (
          <LenderPage />
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <WalletAbiSessionProvider>
      <AppShell />
    </WalletAbiSessionProvider>
  )
}
