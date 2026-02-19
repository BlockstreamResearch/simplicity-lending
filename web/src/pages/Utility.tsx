import { useEffect, useState } from 'react'
import { useSeedHex } from '../SeedContext'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../utility/seed'
import { getP2pkAddressFromSecret } from '../utility/addressP2pk'
import './Utility.css'

const ADDRESS_COUNT = 5
const P2PK_NETWORK: 'testnet' | 'mainnet' = 'testnet'

export function Utility() {
  const seedHex = useSeedHex()
  const [addresses, setAddresses] = useState<{ index: number; address: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!seedHex) {
      queueMicrotask(() => {
        setAddresses([])
        setLoading(false)
      })
      return
    }
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
    })
    const seed = parseSeedHex(seedHex)
    const secrets = Array.from({ length: ADDRESS_COUNT }, (_, i) =>
      deriveSecretKeyFromIndex(seed, i)
    )

    getP2pkAddressFromSecret(secrets[0], P2PK_NETWORK)
      .then(() => {
        if (cancelled) return
        return Promise.all(
          secrets.map((secret, index) =>
            getP2pkAddressFromSecret(secret, P2PK_NETWORK).then((r) => ({
              index,
              address: r.address,
            }))
          )
        )
      })
      .then((list) => {
        if (cancelled) return
        if (list) setAddresses(list)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setAddresses([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [seedHex])

  if (loading)
    return (
      <div className="utility-page">
        <p>Loading addresses…</p>
      </div>
    )

  return (
    <div className="utility-page">
      <h2>Utility</h2>
      <p className="subtitle">
        First 5 addresses (index 0–4), P2PK Simplicity P2TR — same as CLI &quot;basic address
        &lt;index&gt;&quot;
      </p>
      {error && <p className="utility-error">LWK failed: {error}</p>}
      {addresses.length === 0 && !error && <p className="empty">No seed.</p>}
      {addresses.length > 0 && (
        <ul className="address-list">
          {addresses.map(({ index, address }) => (
            <li key={index} className="address-item">
              <span className="address-index">{index}</span>
              <code className="address-value">{address}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
