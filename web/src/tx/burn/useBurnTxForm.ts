/**
 * Form state for burn tx: select ASSET UTXOs only (no LBTC), no duplicates; one fee UTXO.
 * Each selected asset UTXO → one burn output (OP_RETURN "burn").
 */

import { useCallback, useMemo, useState } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import {
  EsploraApiError,
  type EsploraClient,
  type EsploraVout,
  type ScripthashUtxoEntry,
} from '../../api/esplora'
import type { PsetWithExtractTx } from '../../simplicity'
import { buildBurnTx, finalizeBurnTx } from './buildBurnTx'

function utxoKey(txid: string, vout: number): string {
  return `${txid}:${vout}`
}

export interface BurnSelectedRow {
  id: number
  txid: string
  vout: number
  prevout: EsploraVout | null
  loadError: string | null
}

export interface UseBurnTxFormParams {
  esplora: EsploraClient
  accountAddress: string | null
  seedHex: string | null
  accountIndex: number
  utxos: ScripthashUtxoEntry[]
}

export interface UseBurnTxFormResult {
  /** Only non-LBTC UTXOs (can be burned). */
  assetUtxos: ScripthashUtxoEntry[]
  /** LBTC UTXOs for fee dropdown. */
  nativeUtxos: ScripthashUtxoEntry[]
  selectedRows: BurnSelectedRow[]
  addSelectedUtxo: (txid: string, vout: number) => Promise<void>
  removeSelected: (id: number) => void
  feeUtxoIndex: number
  setFeeUtxoIndex: (n: number) => void
  feeAmount: string
  setFeeAmount: (s: string) => void
  buildError: string | null
  /** Set after Build (unsigned). Sign / Sign & Broadcast use this. */
  builtBurnTx: Awaited<ReturnType<typeof buildBurnTx>> | null
  signedTxHex: string | null
  building: boolean
  broadcastTxid: string | null
  broadcastError: string | null
  handleBuild: () => Promise<void>
  handleSign: () => Promise<void>
  handleBuildAndBroadcast: () => Promise<void>
  handleClear: () => void
  clearBroadcastState: () => void
  canBuild: boolean
}

export function useBurnTxForm({
  esplora,
  accountAddress,
  seedHex,
  accountIndex,
  utxos,
}: UseBurnTxFormParams): UseBurnTxFormResult {
  const assetUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => u.asset && u.asset.trim().toLowerCase() !== policyId)
  }, [utxos])

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const [selectedRows, setSelectedRows] = useState<BurnSelectedRow[]>([])
  const [nextId, setNextId] = useState(0)
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtBurnTx, setBuiltBurnTx] = useState<Awaited<
    ReturnType<typeof buildBurnTx>
  > | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)

  const selectedKeys = useMemo(
    () => new Set(selectedRows.map((r) => utxoKey(r.txid, r.vout))),
    [selectedRows]
  )

  const loadPrevout = useCallback(
    async (txid: string, vout: number): Promise<EsploraVout | null> => {
      try {
        const tx = await esplora.getTx(txid)
        const v = tx.vout?.[vout]
        if (!v || v.value == null) return null
        return v
      } catch {
        return null
      }
    },
    [esplora]
  )

  const addSelectedUtxo = useCallback(
    async (txid: string, vout: number) => {
      const key = utxoKey(txid, vout)
      if (selectedKeys.has(key)) return
      const isAsset = assetUtxos.some((u) => u.txid === txid && u.vout === vout)
      if (!isAsset) return

      const id = nextId
      setNextId((n) => n + 1)
      setSelectedRows((prev) => [...prev, { id, txid, vout, prevout: null, loadError: null }])

      const prevout = await loadPrevout(txid, vout)
      setSelectedRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                prevout,
                loadError: prevout ? null : 'Failed to load prevout',
              }
            : r
        )
      )
    },
    [selectedKeys, assetUtxos, nextId, loadPrevout]
  )

  const removeSelected = useCallback((id: number) => {
    setSelectedRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const handleClear = useCallback(() => {
    setSelectedRows([])
    setFeeAmount('')
    setBuildError(null)
    setBuiltBurnTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
  }, [])

  const feeUtxo = nativeUtxos[feeUtxoIndex] ?? null
  const feeNum = parseInt(feeAmount, 10) || 0
  const allSelectedLoaded = selectedRows.length > 0 && selectedRows.every((r) => r.prevout != null)
  const canBuild =
    !!accountAddress &&
    !!seedHex &&
    selectedRows.length > 0 &&
    allSelectedLoaded &&
    feeUtxo != null &&
    feeNum > 0 &&
    (feeUtxo.value ?? 0) >= feeNum

  const handleBuild = useCallback(async () => {
    if (!accountAddress || !canBuild) return
    const assetInputs = selectedRows
      .filter((r) => r.prevout != null)
      .map((r) => ({
        outpoint: { txid: r.txid, vout: r.vout },
        prevout: r.prevout!,
      }))
    if (assetInputs.length === 0) return

    const fee = nativeUtxos[feeUtxoIndex]
    if (!fee) return
    const feePrevout = await loadPrevout(fee.txid, fee.vout)
    if (!feePrevout) return

    setBuildError(null)
    setBuiltBurnTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const result = await buildBurnTx({
        assetInputs,
        feeUtxo: { outpoint: { txid: fee.txid, vout: fee.vout }, prevout: feePrevout },
        feeAmount: BigInt(feeNum),
        network: P2PK_NETWORK,
      })
      setBuiltBurnTx(result)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [
    accountAddress,
    canBuild,
    selectedRows,
    feeUtxoIndex,
    nativeUtxos,
    feeNum,
    loadPrevout,
  ])

  const handleSign = useCallback(async () => {
    if (!builtBurnTx || !seedHex || !accountAddress) return
    setBuildError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizeBurnTx({
        pset: builtBurnTx.pset as PsetWithExtractTx,
        prevouts: builtBurnTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [builtBurnTx, seedHex, accountAddress, accountIndex])

  const handleBuildAndBroadcast = useCallback(async () => {
    if (!builtBurnTx || !seedHex || !accountAddress || !canBuild) return
    const assetInputs = selectedRows
      .filter((r) => r.prevout != null)
      .map((r) => ({
        outpoint: { txid: r.txid, vout: r.vout },
        prevout: r.prevout!,
      }))
    if (assetInputs.length === 0) return

    const fee = nativeUtxos[feeUtxoIndex]
    if (!fee) return
    const feePrevout = await loadPrevout(fee.txid, fee.vout)
    if (!feePrevout) return

    setBuildError(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizeBurnTx({
        pset: builtBurnTx.pset as PsetWithExtractTx,
        prevouts: builtBurnTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      const txidRes = await esplora.broadcastTx(hex)
      setSignedTxHex(hex)
      setBroadcastTxid(txidRes)
      setBroadcastError(null)
    } catch (e) {
      if (e instanceof EsploraApiError) {
        setBroadcastError(e.body ?? e.message)
        setBroadcastTxid(null)
      } else {
        setBuildError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBuilding(false)
    }
  }, [
    builtBurnTx,
    seedHex,
    accountAddress,
    accountIndex,
    canBuild,
    selectedRows,
    feeUtxoIndex,
    nativeUtxos,
    feeNum,
    loadPrevout,
    esplora,
  ])

  const clearBroadcastState = useCallback(() => {
    setBroadcastTxid(null)
    setBroadcastError(null)
  }, [])

  return {
    assetUtxos,
    nativeUtxos,
    selectedRows,
    addSelectedUtxo,
    removeSelected,
    feeUtxoIndex,
    setFeeUtxoIndex,
    feeAmount,
    setFeeAmount,
    buildError,
    builtBurnTx,
    signedTxHex,
    building,
    broadcastTxid,
    broadcastError,
    handleBuild,
    handleSign,
    handleBuildAndBroadcast,
    handleClear,
    clearBroadcastState,
    canBuild,
  }
}
