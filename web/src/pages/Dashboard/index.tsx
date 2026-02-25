/**
 * Dashboard: YOUR BORROWS / YOUR SUPPLY cards and MOST RECENT 10 SUPPLY OFFERS table.
 * Borrow button → Borrower tab; Supply button → Lender tab.
 * Offers are loaded from Indexer API (GET /offers).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tab } from '../../App'
import { fetchOffers } from '../../api/client'
import { EsploraClient } from '../../api/esplora'
import { OfferTable } from '../../components/OfferTable'
import type { OfferShort } from '../../types/offers'

export function Dashboard({ onTab }: { onTab: (t: Tab) => void }) {
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)

  const esplora = useMemo(() => new EsploraClient(), [])

  const loadOffers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, height] = await Promise.all([
        fetchOffers({ limit: 10, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setOffers(list)
      setCurrentBlockHeight(height)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOffers([])
    } finally {
      setLoading(false)
    }
  }, [esplora])

  useEffect(() => {
    loadOffers()
  }, [loadOffers])
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-600">
              B
            </span>
            <h2 className="text-base font-semibold text-gray-900">YOUR BORROWS</h2>
          </div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-gray-500">COMPLETE BALANCE LBTC</span>
            <span className="text-sm font-medium text-green-600">24H +2.3%</span>
          </div>
          <p className="mb-1 text-2xl font-bold text-gray-900">0.00</p>
          <p className="mb-4 text-sm text-gray-500">$0.00 USD</p>
          <ul className="mb-6 space-y-1 text-sm text-gray-600">
            <li>LBTC Locked: 0 LBTC</li>
            <li>Number of Active Deals: 0</li>
            <li>Number of Pending Deals: 0</li>
          </ul>
          <button
            type="button"
            onClick={() => onTab('borrower')}
            className="w-full rounded-lg bg-[#5F3DC4] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#4f36a8]"
          >
            Borrow
          </button>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-600">
              S
            </span>
            <h2 className="text-base font-semibold text-gray-900">YOUR SUPPLY</h2>
          </div>
          <div className="mb-2 text-sm text-gray-500">COMPLETE BALANCE USDT</div>
          <p className="mb-1 text-2xl font-bold text-gray-900">60,000.00</p>
          <p className="mb-4 text-sm text-gray-500">$59,914.89 USD</p>
          <ul className="mb-6 space-y-1 text-sm text-gray-600">
            <li>USDT Supplied: 50,000 USDT</li>
            <li>Number of Active Deals: 1</li>
            <li>Number of Deals Expecting Liquidation: 0</li>
          </ul>
          <button
            type="button"
            onClick={() => onTab('lender')}
            className="w-full rounded-lg bg-[#5F3DC4] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#4f36a8]"
          >
            Supply
          </button>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-gray-500">★</span>
          <h3 className="text-base font-semibold text-gray-900">MOST RECENT 10 SUPPLY OFFERS</h3>
        </div>
        <OfferTable
          offers={offers}
          loading={loading}
          error={error}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadOffers}
          emptyMessage="No offers yet"
        />
        <div className="mt-3 flex justify-center gap-2 text-sm">
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50"
            aria-label="Previous page"
            disabled
          >
            &lt;
          </button>
          <span className="rounded-lg border border-gray-300 bg-gray-800 px-2 py-1 text-sm font-medium text-white">
            1
          </span>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50"
            aria-label="Next page"
            disabled
          >
            &gt;
          </button>
        </div>
      </section>
    </div>
  )
}
