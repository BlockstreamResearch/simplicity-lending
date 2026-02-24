import { useState, useEffect } from 'react'
import { SeedGate } from './SeedGate'
import { Utility } from './pages/Utility'
import { CreateOfferPage } from './pages/CreateOffer'
import { Dashboard } from './pages/Dashboard'
import { LenderPage } from './pages/Lender'
import { AccountMenu } from './components/AccountMenu'
import { parseSeedHex, deriveSecretKeyFromIndex } from './utility/seed'
import { getP2pkAddressFromSecret } from './utility/addressP2pk'

const SEED_STORAGE_KEY = 'simplicity-lending-seed-hex'
const ACCOUNT_INDEX_STORAGE_KEY = 'simplicity-lending-account-index'
const P2PK_NETWORK: 'testnet' | 'mainnet' = 'testnet'

export type Tab = 'dashboard' | 'utility' | 'borrower' | 'lender'

function Header({
  tab,
  onTab,
  accountIndex,
  accountAddress,
  addressLoading,
  onAccountIndexChange,
  onDisconnect,
  showTabs,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  accountIndex: number
  accountAddress: string | null
  addressLoading: boolean
  onAccountIndexChange: (index: number) => void
  onDisconnect: () => void
  showTabs: boolean
}) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-8 py-4 flex justify-between items-center">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold uppercase text-gray-900">LENDING DEMO</h1>
          <p className="text-sm uppercase text-gray-500">POWERED BY SIMPLICITY</p>
        </div>
        {showTabs && (
          <div className="flex items-center gap-6">
            <nav className="flex gap-6">
              <button
                type="button"
                className={
                  'border-0 bg-transparent p-0 min-w-0 rounded-none shadow-none cursor-pointer ' +
                  'hover:underline focus:ring-0 focus:ring-offset-0 ' +
                  (tab === 'dashboard'
                    ? 'font-semibold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900 font-medium')
                }
                onClick={() => onTab('dashboard')}
              >
                Dashboard
              </button>
              <button
                type="button"
                className={
                  'border-0 bg-transparent p-0 min-w-0 rounded-none shadow-none cursor-pointer ' +
                  'hover:underline focus:ring-0 focus:ring-offset-0 ' +
                  (tab === 'utility'
                    ? 'font-semibold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900 font-medium')
                }
                onClick={() => onTab('utility')}
              >
                Utility
              </button>
              <button
                type="button"
                className={
                  'border-0 bg-transparent p-0 min-w-0 rounded-none shadow-none cursor-pointer ' +
                  'hover:underline focus:ring-0 focus:ring-offset-0 ' +
                  (tab === 'borrower'
                    ? 'font-semibold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900 font-medium')
                }
                onClick={() => onTab('borrower')}
              >
                Borrower
              </button>
              <button
                type="button"
                className={
                  'border-0 bg-transparent p-0 min-w-0 rounded-none shadow-none cursor-pointer ' +
                  'hover:underline focus:ring-0 focus:ring-offset-0 ' +
                  (tab === 'lender'
                    ? 'font-semibold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900 font-medium')
                }
                onClick={() => onTab('lender')}
              >
                Lender
              </button>
            </nav>
            <AccountMenu
              accountIndex={accountIndex}
              accountAddress={accountAddress}
              addressLoading={addressLoading}
              onAccountIndexChange={onAccountIndexChange}
              onDisconnect={onDisconnect}
            />
          </div>
        )}
      </div>
    </header>
  )
}

function AppContent({
  tab,
  onTab,
  accountIndex,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  accountIndex: number
}) {
  return (
    <main className="max-w-7xl mx-auto px-8 py-8">
      {tab === 'dashboard' && <Dashboard onTab={onTab} />}

      {tab === 'utility' && <Utility accountIndex={accountIndex} />}

      {tab === 'borrower' && <CreateOfferPage accountIndex={accountIndex} onTab={onTab} />}

      {tab === 'lender' && <LenderPage onTab={onTab} />}
    </main>
  )
}

function readStoredAccountIndex(): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(ACCOUNT_INDEX_STORAGE_KEY)
  if (raw === null) return 0
  const n = parseInt(raw, 10)
  return Number.isNaN(n) || n < 0 ? 0 : n
}

export default function App() {
  const [seedHex, setSeedHexState] = useState<string | null>(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(SEED_STORAGE_KEY) : null
  )
  const [accountIndex, setAccountIndexState] = useState(readStoredAccountIndex)
  const [currentAccountAddress, setCurrentAccountAddress] = useState<string | null>(null)
  const [addressLoading, setAddressLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('dashboard')

  useEffect(() => {
    if (!seedHex) return
    let cancelled = false
    void (async () => {
      setAddressLoading(true)
      setCurrentAccountAddress(null)
      try {
        const seed = parseSeedHex(seedHex)
        const secret = deriveSecretKeyFromIndex(seed, accountIndex)
        const r = await getP2pkAddressFromSecret(secret, P2PK_NETWORK)
        if (!cancelled) setCurrentAccountAddress(r.address)
      } catch {
        if (!cancelled) setCurrentAccountAddress(null)
      } finally {
        if (!cancelled) setAddressLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seedHex, accountIndex])

  const setSeedHex = (hex: string | null) => {
    setSeedHexState(hex)
    if (hex === null) {
      setCurrentAccountAddress(null)
      setAddressLoading(false)
    }
    if (typeof localStorage === 'undefined') return
    if (hex === null) {
      localStorage.removeItem(SEED_STORAGE_KEY)
    } else {
      localStorage.setItem(SEED_STORAGE_KEY, hex)
    }
  }

  const setAccountIndex = (index: number) => {
    const n = index >= 0 ? index : 0
    setAccountIndexState(n)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACCOUNT_INDEX_STORAGE_KEY, String(n))
    }
  }

  const handleDisconnect = () => {
    setSeedHex(null)
  }

  const handleTab = (t: Tab) => {
    setTab(t)
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header
        tab={tab}
        onTab={handleTab}
        accountIndex={accountIndex}
        accountAddress={currentAccountAddress}
        addressLoading={addressLoading}
        onAccountIndexChange={setAccountIndex}
        onDisconnect={handleDisconnect}
        showTabs={seedHex !== null}
      />
      <div className="flex-1 flex justify-center w-full">
        <SeedGate seedHex={seedHex} setSeedHex={setSeedHex} accountIndex={accountIndex}>
          <AppContent tab={tab} onTab={handleTab} accountIndex={accountIndex} />
        </SeedGate>
      </div>
    </div>
  )
}
