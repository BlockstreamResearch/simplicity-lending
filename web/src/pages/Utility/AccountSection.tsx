/**
 * Account section: P2PK address, chain/mempool stats, UTXO list (sortable), refresh.
 * Optional onUtxoSelect(txid, vout, isLbtc) to fill split form outpoint when user clicks a UTXO.
 */

import { useMemo, useState, useCallback } from 'react'
import type { AddressInfo } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'

type SortBy = 'txid' | 'value' | 'asset'
type SortDir = 'asc' | 'desc'

function sortUtxos(
  utxos: ScripthashUtxoEntry[],
  sortBy: SortBy,
  sortDir: SortDir
): ScripthashUtxoEntry[] {
  const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
  return [...utxos].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'txid') {
      cmp = a.txid.localeCompare(b.txid) || a.vout - b.vout
    } else if (sortBy === 'value') {
      const va = a.value ?? 0
      const vb = b.value ?? 0
      cmp = va - vb
    } else {
      const aa = !a.asset || a.asset.trim().toLowerCase() === policyId ? 'LBTC' : (a.asset ?? '')
      const ab = !b.asset || b.asset.trim().toLowerCase() === policyId ? 'LBTC' : (b.asset ?? '')
      cmp = aa.localeCompare(ab) || a.txid.localeCompare(b.txid) || a.vout - b.vout
    }
    return sortDir === 'asc' ? cmp : -cmp
  })
}

function SortableTh({
  field,
  label,
  align = 'left',
  sortBy,
  sortDir,
  onToggle,
}: {
  field: SortBy
  label: string
  align?: 'left' | 'right'
  sortBy: SortBy
  sortDir: SortDir
  onToggle: (field: SortBy) => void
}) {
  return (
    <th
      className={`py-2.5 px-3 border-b border-gray-200 font-semibold text-gray-700 cursor-pointer select-none hover:bg-gray-100 ${align === 'right' ? 'text-right' : 'text-left'} ${field === 'value' ? 'w-24' : field === 'asset' ? 'w-20' : ''}`}
      onClick={() => onToggle(field)}
      role="columnheader"
    >
      {label}
      {sortBy === field && (sortDir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  )
}

export interface AccountSectionProps {
  accountIndex: number
  seedHex: string | null
  address: string | null
  addressInfo: AddressInfo | null
  utxos: ScripthashUtxoEntry[]
  loading: boolean
  error: string | null
  refreshing: boolean
  onRefresh: () => void
  onUtxoSelect?: (txid: string, vout: number, isLbtc: boolean) => void
}

export function AccountSection({
  accountIndex,
  seedHex,
  address,
  addressInfo,
  utxos,
  loading,
  error,
  refreshing,
  onRefresh,
  onUtxoSelect,
}: AccountSectionProps) {
  const [sortBy, setSortBy] = useState<SortBy>('txid')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = useCallback((field: SortBy) => {
    setSortBy(field)
    setSortDir((d) => (field === 'txid' ? 'asc' : d === 'asc' ? 'desc' : 'asc'))
  }, [])

  const sortedUtxos = useMemo(() => sortUtxos(utxos, sortBy, sortDir), [utxos, sortBy, sortDir])

  return (
    <section className="min-w-0 max-w-4xl">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Account {accountIndex} — address</h3>
          {seedHex && (
            <button
              type="button"
              className="p-1.5 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              onClick={onRefresh}
              disabled={loading || refreshing}
              title="Update address info"
              aria-label="Update address info"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshing ? 'animate-spin' : ''}
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
          )}
        </div>
        <div className="p-5 space-y-5">
          {loading && !addressInfo ? (
            <p className="text-gray-600">Loading…</p>
          ) : error ? (
            <p className="text-red-700 bg-red-50 p-4 rounded-xl border border-red-100">{error}</p>
          ) : !seedHex ? (
            <p className="text-gray-600">No seed.</p>
          ) : addressInfo ? (
            <>
              {address && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Address</p>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                    <code className="font-mono text-sm text-gray-900 break-all">{address}</code>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-2">Chain</p>
                  <p className="text-sm text-gray-700">
                    tx_count: {addressInfo.chain_stats.tx_count}
                  </p>
                  <p className="text-sm text-gray-700">
                    funded_txo: {addressInfo.chain_stats.funded_txo_count}
                  </p>
                  <p className="text-sm text-gray-700">
                    spent_txo: {addressInfo.chain_stats.spent_txo_count}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-2">Mempool</p>
                  <p className="text-sm text-gray-700">
                    tx_count: {addressInfo.mempool_stats.tx_count}
                  </p>
                  <p className="text-sm text-gray-700">
                    funded_txo: {addressInfo.mempool_stats.funded_txo_count}
                  </p>
                  <p className="text-sm text-gray-700">
                    spent_txo: {addressInfo.mempool_stats.spent_txo_count}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-2">UTXOs ({utxos.length})</p>
                {utxos.length === 0 ? (
                  <p className="text-gray-500 text-sm py-2">No unspent outputs.</p>
                ) : (
                  <div className="rounded-xl border border-gray-200 overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full min-w-[32rem] text-sm font-mono border-collapse">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left py-2.5 px-3 border-b border-gray-200 font-semibold text-gray-700 w-16">
                            vout
                          </th>
                          <SortableTh
                            field="txid"
                            label="txid"
                            sortBy={sortBy}
                            sortDir={sortDir}
                            onToggle={toggleSort}
                          />
                          <SortableTh
                            field="value"
                            label="value"
                            align="right"
                            sortBy={sortBy}
                            sortDir={sortDir}
                            onToggle={toggleSort}
                          />
                          <SortableTh
                            field="asset"
                            label="asset"
                            sortBy={sortBy}
                            sortDir={sortDir}
                            onToggle={toggleSort}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedUtxos.map((u) => {
                          const isLbtc =
                            !u.asset ||
                            u.asset.trim().toLowerCase() === POLICY_ASSET_ID[P2PK_NETWORK]
                          return (
                            <tr
                              key={`${u.txid}:${u.vout}`}
                              role="button"
                              tabIndex={0}
                              className="cursor-pointer hover:bg-gray-50/80 border-b border-gray-100 last:border-b-0 transition-colors"
                              onClick={() => onUtxoSelect?.(u.txid, u.vout, isLbtc)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  onUtxoSelect?.(u.txid, u.vout, isLbtc)
                                }
                              }}
                            >
                              <td className="py-2 px-3 text-gray-500">{u.vout}</td>
                              <td
                                className="py-2 px-3 text-gray-700 truncate max-w-[18rem]"
                                title={u.txid}
                              >
                                {u.txid}
                              </td>
                              <td className="py-2 px-3 text-right text-gray-900">
                                {u.value ?? '—'}
                              </td>
                              <td className="py-2 px-3 text-gray-600">
                                {isLbtc ? 'LBTC' : 'ASSET'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
