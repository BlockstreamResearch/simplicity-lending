import { useCallback, useEffect, useMemo, useState } from 'react'
import { EsploraClient, type AddressInfo, type ScripthashUtxoEntry } from '../api/esplora'

export interface UseWalletAddressDataResult {
  addressInfo: AddressInfo | null
  utxos: ScripthashUtxoEntry[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  refreshing: boolean
}

export function useWalletAddressData(address: string | null): UseWalletAddressDataResult {
  const esplora = useMemo(() => new EsploraClient(), [])
  const [addressInfo, setAddressInfo] = useState<AddressInfo | null>(null)
  const [utxos, setUtxos] = useState<ScripthashUtxoEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!address) {
      setAddressInfo(null)
      setUtxos([])
      setError(null)
      return
    }

    setRefreshing(true)
    try {
      const [nextInfo, nextUtxos] = await Promise.all([
        esplora.getAddressInfo(address),
        esplora.getAddressUtxo(address),
      ])
      setAddressInfo(nextInfo)
      setUtxos(nextUtxos)
      setError(null)
    } catch (nextError) {
      setAddressInfo(null)
      setUtxos([])
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setRefreshing(false)
    }
  }, [address, esplora])

  useEffect(() => {
    if (!address) {
      setAddressInfo(null)
      setUtxos([])
      setLoading(false)
      setError(null)
      return
    }

    let active = true
    setLoading(true)

    void (async () => {
      try {
        const [nextInfo, nextUtxos] = await Promise.all([
          esplora.getAddressInfo(address),
          esplora.getAddressUtxo(address),
        ])
        if (!active) return
        setAddressInfo(nextInfo)
        setUtxos(nextUtxos)
        setError(null)
      } catch (nextError) {
        if (!active) return
        setAddressInfo(null)
        setUtxos([])
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [address, esplora])

  return {
    addressInfo,
    utxos,
    loading,
    error,
    refresh,
    refreshing,
  }
}
