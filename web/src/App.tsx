import { useEffect, useState } from 'react'
import { fetchOffers } from './api/client'
import type { OfferShort } from './types/offers'
import './App.css'

function App() {
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchOffers({ limit: 50 })
      .then((data) => {
        if (!cancelled) setOffers(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <div className="page">Loading offers…</div>
  if (error) {
    return (
      <div className="page">
        <h1>Simplicity Lending</h1>
        <p className="error">
          Failed to load offers: {error}. Make sure the indexer API is running (e.g. <code>cargo run -p lending-indexer</code>) and CORS is enabled.
        </p>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Simplicity Lending</h1>
      <p className="subtitle">Lending offers</p>
      {offers.length === 0 ? (
        <p className="empty">No offers yet.</p>
      ) : (
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
                <td><span className={`status status-${o.status}`}>{o.status}</span></td>
                <td>{o.collateral_amount.toString()} ({shortHex(o.collateral_asset)})</td>
                <td>{o.principal_amount.toString()} ({shortHex(o.principal_asset)})</td>
                <td>{o.interest_rate}</td>
                <td>{o.loan_expiration_time}</td>
                <td>{o.created_at_height.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function shortHex(hex: string, len = 8): string {
  if (hex.length <= len) return hex
  return hex.slice(0, 4) + '…' + hex.slice(-4)
}

export default App
