/**
 * Lender page: balance cards (LBTC, USDT), YOUR SUPPLY table, MOST RECENT 10 SUPPLY OFFERS.
 */

import { useState } from 'react'
import type { Tab } from '../../App'

const MOCK_MY_SUPPLY = [
  {
    id: 1,
    supplyUsdt: '50,000',
    feeUsdt: '80',
    collateralLbtc: '1',
    termDays: '~15 Days',
    termBlocks: '10,000 Blocks',
    apr: '8.41%',
    ltv: '55.03%',
    status: 'Active' as const,
  },
]

const MOCK_SUPPLY_OFFERS = [
  {
    address: '3456...6543',
    supplyUsdt: '50,000',
    feeUsdt: '80',
    collateralLbtc: '1',
    termDays: '~15 Days',
    termBlocks: '10,000 Blocks',
    apr: '8.41%',
    ltv: '55.03%',
  },
  {
    address: '3456...6543',
    supplyUsdt: '50,000',
    feeUsdt: '80',
    collateralLbtc: '1',
    termDays: '~15 Days',
    termBlocks: '10,000 Blocks',
    apr: '8.41%',
    ltv: '55.03%',
  },
]

export function LenderPage({ onTab }: { onTab: (t: Tab) => void }) {
  const [page, setPage] = useState(1)

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={() => onTab('dashboard')}
        className="flex items-center gap-1 rounded-lg bg-[#5F3DC4] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4f36a8]"
      >
        <span aria-hidden>&lt;</span>
        <span>Back to Dashboard</span>
      </button>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-xs font-medium text-teal-700">
              L
            </span>
            <h2 className="text-base font-semibold text-gray-900">LBTC</h2>
          </div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm uppercase text-gray-500">COMPLETE BALANCE LBTC</span>
            <span className="text-sm font-medium text-green-600">24H +2.3%</span>
          </div>
          <p className="mb-1 text-2xl font-bold text-gray-900">0.00</p>
          <p className="mb-4 text-sm text-gray-500">$0.00 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">LOAN COLLATERAL:</span>{' '}
            <span className="text-gray-600">0 LBTC</span>
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700">
              U
            </span>
            <h2 className="text-base font-semibold text-gray-900">USDT</h2>
          </div>
          <div className="mb-2 text-sm uppercase text-gray-500">COMPLETE BALANCE USDT</div>
          <p className="mb-1 text-2xl font-bold text-gray-900">60,000.00</p>
          <p className="mb-4 text-sm text-gray-500">$59,914.89 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">SUPPLIED:</span>{' '}
            <span className="text-gray-600">50,000 USDT</span>
          </p>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-gray-500" aria-hidden>
            &#9650;
          </span>
          <h3 className="text-base font-semibold uppercase text-gray-900">YOUR SUPPLY</h3>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  # ID <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Supply (USDT) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Fee (USDT) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Collateral (LBTC) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Term (Blocks) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  APR <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  LTV <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Status <span className="text-gray-400">↕</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {MOCK_MY_SUPPLY.map((row) => (
                <tr key={row.id} className="border-t border-gray-200">
                  <td className="py-2 px-3 text-sm text-gray-900">#{row.id}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.supplyUsdt}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.feeUsdt}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.collateralLbtc}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">
                    <span className="block">{row.termDays}</span>
                    <span className="block text-gray-500">{row.termBlocks}</span>
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.apr}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.ltv}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-sm font-medium text-green-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-gray-500">★</span>
          <h3 className="text-base font-semibold text-gray-900">MOST RECENT 10 SUPPLY OFFERS</h3>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Address <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Supply (USDT) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Fee (USDT) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Collateral (LBTC) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  Term (Blocks) <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  APR <span className="text-gray-400">↕</span>
                </th>
                <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                  LTV <span className="text-gray-400">↕</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {MOCK_SUPPLY_OFFERS.map((row, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="py-2 px-3 text-sm text-gray-900">{row.address}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.supplyUsdt}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.feeUsdt}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.collateralLbtc}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">
                    <span className="block">{row.termDays}</span>
                    <span className="block text-gray-500">{row.termBlocks}</span>
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.apr}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{row.ltv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400"
            aria-label="Previous page"
          >
            &lt;
          </button>
          <button
            type="button"
            onClick={() => setPage(1)}
            className={`rounded-lg border px-2 py-1 text-sm font-medium ${
              page === 1
                ? 'border-gray-800 bg-gray-800 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400'
            }`}
          >
            1
          </button>
          <button
            type="button"
            onClick={() => setPage(2)}
            className={`rounded-lg border px-2 py-1 text-sm font-medium ${
              page === 2
                ? 'border-gray-800 bg-gray-800 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400'
            }`}
          >
            2
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400"
            aria-label="Next page"
          >
            &gt;
          </button>
        </div>
      </section>
    </div>
  )
}
