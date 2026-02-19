import { useState } from 'react'
import { SeedGate } from './SeedGate'
import { fetchOffers } from './api/client'
import type { OfferShort } from './types/offers'
import { Utility } from './pages/Utility'
import './App.css'

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
    <div className="page">
      <h1>Simplicity Lending</h1>
      <nav className="nav">
        <a
          href="#offers"
          className={tab === 'offers' ? 'active' : ''}
          onClick={(e) => {
            e.preventDefault()
            handleTab('offers')
          }}
        >
          Offers
        </a>
        <a
          href="#utility"
          className={tab === 'utility' ? 'active' : ''}
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
          <p className="subtitle">Lending offers</p>
          {loading && <p>Loading offers…</p>}
          {error && (
            <p className="error">
              Failed to load offers: {error}. Make sure the indexer API is running and CORS is
              enabled.
            </p>
          )}
          {!loading && !error && offers.length === 0 && <p className="empty">No offers yet.</p>}
          {!loading && !error && offers.length > 0 && (
            <table className="offers-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Collateral</th>
                  <th>Principal</th>
                  <th>Interest rate</th>
                  <th>Expiry (blocks)</th>
                  <th>Created at height</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className={`status status-${o.status}`}>{o.status}</span>
                    </td>
                    <td>
                      {o.collateral_amount.toString()} ({shortHex(o.collateral_asset)})
                    </td>
                    <td>
                      {o.principal_amount.toString()} ({shortHex(o.principal_asset)})
                    </td>
                    <td>{o.interest_rate}</td>
                    <td>{o.loan_expiration_time}</td>
                    <td>{o.created_at_height.toString()}</td>
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
