import { useEffect, useState, useMemo } from 'react'
import { useSeedHex } from '../SeedContext'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../utility/seed'
import { getP2pkAddressFromSecret } from '../utility/addressP2pk'
import {
  EsploraClient,
  type AddressInfo,
  type ScripthashUtxoEntry,
} from '../api/esplora'

const P2PK_NETWORK: 'testnet' | 'mainnet' = 'testnet'
const ADDRESS_POLL_MS = 30_000

export function Utility({ accountIndex }: { accountIndex: number }) {
  const seedHex = useSeedHex()
  const esplora = useMemo(() => new EsploraClient(), [])
  const [addressInfo, setAddressInfo] = useState<AddressInfo | null>(null)
  const [addressUtxos, setAddressUtxos] = useState<ScripthashUtxoEntry[]>([])
  const [accountAddress, setAccountAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!seedHex) {
      setAddressInfo(null)
      setAddressUtxos([])
      setAccountAddress(null)
      setLoading(false)
      setError(null)
      return
    }
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const seed = parseSeedHex(seedHex)
        const secret = deriveSecretKeyFromIndex(seed, accountIndex)
        const { address } = await getP2pkAddressFromSecret(secret, P2PK_NETWORK)
        if (cancelled) return
        setAccountAddress(address)
        const [info, utxos] = await Promise.all([
          esplora.getAddressInfo(address),
          esplora.getAddressUtxo(address),
        ])
        if (!cancelled) {
          setAddressInfo(info)
          setAddressUtxos(utxos)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setAddressInfo(null)
          setAddressUtxos([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    const interval = setInterval(run, ADDRESS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [seedHex, accountIndex, esplora])

  return (
    <div>
      <section className="min-w-0 max-w-2xl">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Account {accountIndex} — address
          </h3>
          {loading && !addressInfo ? (
            <p className="text-gray-600">Loading…</p>
          ) : error ? (
            <p className="text-red-700 bg-red-50 p-3 rounded-lg">{error}</p>
          ) : !seedHex ? (
            <p className="text-gray-600">No seed.</p>
          ) : addressInfo ? (
            <div className="space-y-3">
              {accountAddress && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-700">Address:</span>{' '}
                  <code className="font-mono break-all bg-gray-100 px-1.5 py-0.5 rounded">
                    {accountAddress}
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
                <p className="font-semibold text-gray-700 mb-1">UTXOs ({addressUtxos.length})</p>
                {addressUtxos.length === 0 ? (
                  <p className="text-gray-500 text-sm">No unspent outputs.</p>
                ) : (
                  <ul className="list-none p-0 space-y-2 max-h-48 overflow-y-auto rounded border border-gray-200">
                    {addressUtxos.map((u) => (
                      <li
                        key={`${u.txid}:${u.vout}`}
                        className="flex items-center gap-2 py-2 px-3 border-b border-gray-100 last:border-b-0 text-sm font-mono"
                      >
                        <span className="text-gray-500 shrink-0">{u.vout}</span>
                        <span className="truncate text-gray-700">{u.txid}</span>
                        {u.value != null && (
                          <span className="shrink-0 text-gray-900">{u.value}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
      </section>
    </div>
  )
}
