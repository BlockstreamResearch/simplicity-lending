/**
 * Account section: P2PK address, chain/mempool stats, UTXO list, refresh.
 * Optional onUtxoSelect(txid, vout) to fill split form outpoint when user clicks a UTXO.
 */

import type { AddressInfo } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'

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
  onUtxoSelect?: (txid: string, vout: number) => void
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
  return (
    <section className="min-w-0 max-w-4xl">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-lg font-semibold text-gray-900">Account {accountIndex} — address</h3>
        {seedHex && (
          <button
            type="button"
            className="p-1 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:pointer-events-none"
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
      {loading && !addressInfo ? (
        <p className="text-gray-600">Loading…</p>
      ) : error ? (
        <p className="text-red-700 bg-red-50 p-3 rounded-lg">{error}</p>
      ) : !seedHex ? (
        <p className="text-gray-600">No seed.</p>
      ) : addressInfo ? (
        <div className="space-y-3">
          {address && (
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">Address:</span>{' '}
              <code className="font-mono break-all bg-gray-100 px-1.5 py-0.5 rounded">
                {address}
              </code>
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="font-semibold text-gray-700 mb-1">Chain</p>
              <p>tx_count: {addressInfo.chain_stats.tx_count}</p>
              <p>funded_txo: {addressInfo.chain_stats.funded_txo_count}</p>
              <p>spent_txo: {addressInfo.chain_stats.spent_txo_count}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="font-semibold text-gray-700 mb-1">Mempool</p>
              <p>tx_count: {addressInfo.mempool_stats.tx_count}</p>
              <p>funded_txo: {addressInfo.mempool_stats.funded_txo_count}</p>
              <p>spent_txo: {addressInfo.mempool_stats.spent_txo_count}</p>
            </div>
          </div>
          <div>
            <p className="font-semibold text-gray-700 mb-1">UTXOs ({utxos.length})</p>
            {utxos.length === 0 ? (
              <p className="text-gray-500 text-sm">No unspent outputs.</p>
            ) : (
              <div className="max-h-56 overflow-auto rounded border border-gray-200">
                <table className="w-full min-w-[32rem] text-sm font-mono border-collapse">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700 w-16">
                        vout
                      </th>
                      <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700">
                        txid
                      </th>
                      <th className="text-right py-2 px-3 border-b border-gray-200 font-semibold text-gray-700 w-24">
                        value
                      </th>
                      <th className="text-left py-2 px-3 border-b border-gray-200 font-semibold text-gray-700 w-20">
                        asset
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {utxos.map((u) => (
                      <tr
                        key={`${u.txid}:${u.vout}`}
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                        onClick={() => onUtxoSelect?.(u.txid, u.vout)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onUtxoSelect?.(u.txid, u.vout)
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
                        <td className="py-2 px-3 text-right text-gray-900">{u.value ?? '—'}</td>
                        <td className="py-2 px-3 text-gray-600">
                          {!u.asset ||
                          u.asset.trim().toLowerCase() === POLICY_ASSET_ID[P2PK_NETWORK]
                            ? 'LBTC'
                            : 'ASSET'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
