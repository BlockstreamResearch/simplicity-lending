/**
 * Borrower page: dashboard and Create Borrow Offer wizard in a popup.
 * Uses useAccountAddress for UTXOs and refresh after broadcast.
 */

import { useMemo, useState, useEffect } from 'react'
import type { Tab } from '../../App'
import { useSeedHex } from '../../SeedContext'
import { useAccountAddress } from '../../hooks/useAccountAddress'
import { EsploraClient } from '../../api/esplora'
import { CreateOfferWizard } from './CreateOfferWizard'
import { Modal } from '../../components/Modal'
import { getStoredPrepareTxid, savePrepareTxid } from './borrowerStorage'

const MOCK_BORROWS = [
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
  {
    id: 2,
    supplyUsdt: '50,000',
    feeUsdt: '80',
    collateralLbtc: '1',
    termDays: '~15 Days',
    termBlocks: '10,000 Blocks',
    apr: '8.41%',
    ltv: '55.03%',
    status: 'Open Offer' as const,
  },
  {
    id: 3,
    supplyUsdt: '50,000',
    feeUsdt: '80',
    collateralLbtc: '1',
    termDays: '~15 Days',
    termBlocks: '10,000 Blocks',
    apr: '8.41%',
    ltv: '55.03%',
    status: 'Open Offer' as const,
  },
]

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  )
}

export function CreateOfferPage({
  accountIndex,
  onTab,
}: {
  accountIndex: number
  onTab: (t: Tab) => void
}) {
  const seedHex = useSeedHex()
  const esplora = useMemo(() => new EsploraClient(), [])
  const {
    address: accountAddress,
    utxos,
    loading,
    error,
    refresh,
  } = useAccountAddress({
    seedHex,
    accountIndex,
    esplora,
  })

  const [showCreateWizard, setShowCreateWizard] = useState(false)
  const [savedPreparedTxid, setSavedPreparedTxid] = useState<string | null>(() =>
    getStoredPrepareTxid(accountIndex)
  )
  useEffect(() => {
    setSavedPreparedTxid(getStoredPrepareTxid(accountIndex))
  }, [accountIndex])

  if (!seedHex) {
    return <p className="text-gray-600">Connect seed to create an offer.</p>
  }

  if (loading) {
    return <p className="text-gray-600">Loading…</p>
  }

  if (error) {
    return <p className="text-red-700 bg-red-50 p-4 rounded-lg">{error}</p>
  }

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={() => onTab('dashboard')}
        className="flex items-center gap-1 text-gray-700 hover:text-gray-900 focus:outline-none focus:ring-0"
      >
        <span aria-hidden>&lt;</span>
        <span>Back to Dashboard</span>
      </button>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700">
              L
            </span>
            <h2 className="text-base font-semibold text-gray-900">LBTC</h2>
          </div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-gray-500">COMPLETE BALANCE LBTC</span>
            <span className="text-sm font-medium text-green-600">24H +2.3%</span>
          </div>
          <p className="mb-1 text-2xl font-bold text-gray-900">7.00976</p>
          <p className="mb-4 text-sm text-gray-500">$792,852.21 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">LBTC LOCKED:</span>{' '}
            <span className="text-gray-600">3 LBTC</span>
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-100 text-xs font-medium text-pink-700">
              U
            </span>
            <h2 className="text-base font-semibold text-gray-900">USDT</h2>
          </div>
          <div className="mb-2 text-sm text-gray-500">COMPLETE BALANCE USDT</div>
          <p className="mb-1 text-2xl font-bold text-gray-900">50,000.00</p>
          <p className="mb-4 text-sm text-gray-500">$49,929.07 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">BORROWED:</span>{' '}
            <span className="text-gray-600">50,000 USDT</span>
          </p>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <WalletIcon className="text-gray-500 shrink-0" />
          <h3 className="text-base font-semibold text-gray-900">YOUR BORROWS</h3>
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
              {MOCK_BORROWS.map((row) => (
                <tr key={row.id} className="border-t border-gray-200">
                  <td className="py-2 px-3 text-sm text-gray-900">{row.id}</td>
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
                    {row.status === 'Active' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-sm font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
                        {row.status}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                        {row.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setShowCreateWizard(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#5F3DC4] px-4 py-2 text-sm font-medium text-white hover:bg-[#4f36a8]"
      >
        <span>+</span>
        Create Borrow Offer
      </button>

      <Modal
        open={showCreateWizard}
        onClose={() => setShowCreateWizard(false)}
        title="Create Borrow Offer"
      >
        <CreateOfferWizard
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          savedPreparedTxid={savedPreparedTxid}
          onBroadcastSuccess={refresh}
          onPrepareSuccess={(txid) => {
            savePrepareTxid(accountIndex, txid)
            setSavedPreparedTxid(txid)
          }}
          onComplete={() => setShowCreateWizard(false)}
        />
      </Modal>
    </div>
  )
}
