/**
 * Hook: load and refresh P2PK account address, address info, and UTXOs.
 * Logic moved from Utility page (fetch address + UTXOs, refresh, effect on seed/index/esplora).
 */

import { useCallback, useEffect, useState, useMemo } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../utility/seed'
import { getP2pkAddressFromSecret, P2PK_NETWORK } from '../utility/addressP2pk'
import { EsploraClient, type AddressInfo, type ScripthashUtxoEntry } from '../api/esplora'

export interface UseAccountAddressParams {
  seedHex: string | null
  accountIndex: number
  esplora?: EsploraClient
}

export interface UseAccountAddressResult {
  address: string | null
  addressInfo: AddressInfo | null
  utxos: ScripthashUtxoEntry[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  refreshing: boolean
}

/**
 * When seedHex is set: derives P2PK address, fetches address info and UTXOs via Esplora.
 * When seedHex is null: resets state and sets loading false.
 */
export function useAccountAddress({
  seedHex,
  accountIndex,
  esplora: esploraParam,
}: UseAccountAddressParams): UseAccountAddressResult {
  const defaultEsplora = useMemo(() => new EsploraClient(), [])
  const esplora = esploraParam ?? defaultEsplora

  const [addressInfo, setAddressInfo] = useState<AddressInfo | null>(null)
  const [utxos, setUtxos] = useState<ScripthashUtxoEntry[]>([])
  const [address, setAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAddressInfo = useCallback(async () => {
    if (!seedHex) return
    setError(null)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const { address: addr } = await getP2pkAddressFromSecret(secret, P2PK_NETWORK)
      setAddress(addr)
      const [info, utxoList] = await Promise.all([
        esplora.getAddressInfo(addr),
        esplora.getAddressUtxo(addr),
      ])
      setAddressInfo(info)
      setUtxos(utxoList)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setAddressInfo(null)
      setUtxos([])
    }
  }, [seedHex, accountIndex, esplora])

  const refresh = useCallback(async () => {
    if (!seedHex || refreshing) return
    setRefreshing(true)
    try {
      await fetchAddressInfo()
    } finally {
      setRefreshing(false)
    }
  }, [seedHex, refreshing, fetchAddressInfo])

  useEffect(() => {
    if (!seedHex) {
      setAddressInfo(null)
      setUtxos([])
      setAddress(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    fetchAddressInfo().finally(() => setLoading(false))
  }, [seedHex, accountIndex, esplora, fetchAddressInfo])

  return {
    address,
    addressInfo,
    utxos,
    loading,
    error,
    refresh,
    refreshing,
  }
}
