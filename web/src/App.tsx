import { useState } from 'react'
import { SeedGate } from './SeedGate'
import { fetchOffers } from './api/client'
import type { OfferShort, OfferStatus } from './types/offers'
import { Utility } from './pages/Utility'

const STATUS_CLASSES: Record<OfferStatus, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  repaid: 'bg-blue-100 text-blue-800',
  liquidated: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-700',
  claimed: 'bg-green-100 text-green-800',
}

type Tab = 'offers' | 'utility'

function AppContent() {
  const [tab, setTab] = useState<Tab>('utility')
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <div className="max-w-5xl mx-auto px-8 py-8">
      <h1 className="mb-1">Simplicity Lending</h1>
      <nav className="flex gap-4 mb-6 border-b border-gray-200 pb-2">
        <a
          href="#offers"
          className={
            tab === 'offers' ? 'font-semibold text-gray-900' : 'text-gray-600 hover:text-gray-900'
          }
          onClick={(e) => {
            e.preventDefault()
            handleTab('offers')
          }}
        >
          Offers
        </a>
        <a
          href="#utility"
          className={
            tab === 'utility' ? 'font-semibold text-gray-900' : 'text-gray-600 hover:text-gray-900'
          }
          onClick={(e) => {
            e.preventDefault()
            handleTab('utility')
          }}
        >
          Utility
        </a>
      </nav>

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

      {tab === 'utility' && <Utility />}
    </div>
  )
}

function shortHex(hex: string, len = 8): string {
  if (hex.length <= len) return hex
  return hex.slice(0, 4) + '…' + hex.slice(-4)
}

export default function App() {
  return (
    <SeedGate>
      <AppContent />
    </SeedGate>
  )
}
