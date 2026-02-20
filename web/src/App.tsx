import { useState, useEffect } from 'react'
import { SeedGate } from './SeedGate'
import { fetchOffers } from './api/client'
import type { OfferShort, OfferStatus } from './types/offers'
import { Utility } from './pages/Utility'
import { AccountMenu } from './components/AccountMenu'
import { parseSeedHex, deriveSecretKeyFromIndex } from './utility/seed'
import { getP2pkAddressFromSecret } from './utility/addressP2pk'

const SEED_STORAGE_KEY = 'simplicity-lending-seed-hex'
const ACCOUNT_INDEX_STORAGE_KEY = 'simplicity-lending-account-index'
const P2PK_NETWORK: 'testnet' | 'mainnet' = 'testnet'

const STATUS_CLASSES: Record<OfferStatus, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  repaid: 'bg-blue-100 text-blue-800',
  liquidated: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-700',
  claimed: 'bg-green-100 text-green-800',
}

type Tab = 'offers' | 'utility'

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
        <h1 className="text-xl font-bold text-gray-900">Simplicity Lending</h1>
        {showTabs && (
          <div className="flex items-center gap-6">
            <nav className="flex gap-6">
              <button
                type="button"
                className={
                  'border-0 bg-transparent p-0 min-w-0 rounded-none shadow-none cursor-pointer ' +
                  'hover:underline focus:ring-0 focus:ring-offset-0 ' +
                  (tab === 'offers'
                    ? 'font-semibold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900 font-medium')
                }
                onClick={() => onTab('offers')}
              >
                Offers
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
  offers,
  loading,
  error,
  accountIndex,
}: {
  tab: Tab
  offers: OfferShort[]
  loading: boolean
  error: string | null
  accountIndex: number
}) {
  return (
    <main className="max-w-7xl mx-auto px-8 py-8">
      {tab === 'offers' && (
        <>
          <p className="text-gray-600 mb-6">Lending offers</p>
          {loading && <p>Loading offers…</p>}
          {error && (
            <p className="text-red-700 bg-red-50 p-4 rounded-lg">
              Failed to load offers: {error}. Make sure the indexer API is running and CORS is
              enabled.
            </p>
          )}
          {!loading && !error && offers.length === 0 && (
            <p className="text-gray-600">No offers yet.</p>
          )}
          {!loading && !error && offers.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                    Status
                  </th>
                  <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                    Collateral
                  </th>
                  <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                    Principal
                  </th>
                  <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                    Interest rate
                  </th>
                  <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                    Expiry (blocks)
                  </th>
                  <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                    Created at height
                  </th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2 px-3 border-b border-gray-200">
                      <span
                        className={`inline-block py-0.5 px-2 rounded text-sm capitalize ${STATUS_CLASSES[o.status]}`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 border-b border-gray-200">
                      {o.collateral_amount.toString()} ({shortHex(o.collateral_asset)})
                    </td>
                    <td className="py-2 px-3 border-b border-gray-200">
                      {o.principal_amount.toString()} ({shortHex(o.principal_asset)})
                    </td>
                    <td className="py-2 px-3 border-b border-gray-200">{o.interest_rate}</td>
                    <td className="py-2 px-3 border-b border-gray-200">{o.loan_expiration_time}</td>
                    <td className="py-2 px-3 border-b border-gray-200">
                      {o.created_at_height.toString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'utility' && <Utility accountIndex={accountIndex} />}
    </main>
  )
}

function shortHex(hex: string, len = 8): string {
  if (hex.length <= len) return hex
  return hex.slice(0, 4) + '…' + hex.slice(-4)
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
  const [tab, setTab] = useState<Tab>('utility')
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const loadOffers = () => {
    setLoading(true)
    setError(null)
    fetchOffers({ limit: 50 })
      .then(setOffers)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  const handleTab = (t: Tab) => {
    setTab(t)
    if (t === 'offers' && offers.length === 0 && !error) loadOffers()
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
          <AppContent tab={tab} offers={offers} loading={loading} error={error} accountIndex={accountIndex} />
        </SeedGate>
      </div>
    </div>
  )
}
