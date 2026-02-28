/**
 * Form state for merge asset tx: multiple inputs (same asset), outputs in that asset, fee in LBTC.
 * After first UTXO is selected, only UTXOs of that asset are shown. If all inputs are cleared, show all asset UTXOs again.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import {
  EsploraApiError,
  type EsploraClient,
  type EsploraVout,
  type ScripthashUtxoEntry,
} from '../../api/esplora'
import { formatBroadcastError } from '../../utils/parseBroadcastError'
import type { PsetWithExtractTx } from '../../simplicity'
import { buildMergeTx, finalizeMergeTx } from './buildMergeTx'
import type { MergeTxOutput } from './buildMergeTx'
import type { TxOutputRow } from '../split/types'
import type { MergeInputRow } from './useMergeTxForm'
import { utxoKey } from '../../utility/utxoKey'

function sameAsset(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

export interface UseMergeAssetTxFormParams {
  esplora: EsploraClient
  accountAddress: string | null
  seedHex: string | null
  accountIndex: number
  utxos: ScripthashUtxoEntry[]
}

export interface UseMergeAssetTxFormResult {
  /** UTXOs that have an asset (not LBTC). */
  assetUtxos: ScripthashUtxoEntry[]
  /** LBTC UTXOs for fee. */
  nativeUtxos: ScripthashUtxoEntry[]
  /** Set once first input has prevout; used to filter dropdown to same asset. */
  selectedAssetId: string | null
  getAvailableUtxosForRow: (rowId: number) => ScripthashUtxoEntry[]
  selectInputUtxo: (rowId: number, txid: string, vout: number) => Promise<void>
  clearInputRow: (rowId: number) => void
  inputRows: MergeInputRow[]
  addInputRow: () => void
  removeInputRow: (id: number) => void
  feeUtxoIndex: number
  setFeeUtxoIndex: (index: number) => void
  feeAmount: string
  setFeeAmount: (s: string) => void
  outputs: TxOutputRow[]
  addOutput: () => void
  removeOutput: (id: number) => void
  updateOutput: (id: number, field: 'address' | 'amount', value: string) => void
  moveOutput: (index: number, dir: 1 | -1) => void
  buildError: string | null
  builtMergeTx: Awaited<ReturnType<typeof buildMergeTx>> | null
  signedTxHex: string | null
  building: boolean
  broadcastTxid: string | null
  broadcastError: string | null
  handleBuild: () => Promise<void>
  handleSign: () => Promise<void>
  handleBuildAndBroadcast: () => Promise<void>
  handleClear: () => void
  clearBroadcastState: () => void
  totalInputValue: number
  outputsSum: number
  changeAmount: number
  canBuild: boolean
}

export function useMergeAssetTxForm({
  esplora,
  accountAddress,
  seedHex,
  accountIndex,
  utxos,
}: UseMergeAssetTxFormParams): UseMergeAssetTxFormResult {
  const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
  const assetUtxos = useMemo(() => {
    return utxos.filter((u) => u.asset && u.asset.trim().toLowerCase() !== policyId.toLowerCase())
  }, [utxos, policyId])
  const nativeUtxos = useMemo(() => {
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos, policyId])

  const [nextInputId, setNextInputId] = useState(0)
  const [inputRows, setInputRows] = useState<MergeInputRow[]>([])
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [outputs, setOutputs] = useState<TxOutputRow[]>([])
  const [nextOutputId, setNextOutputId] = useState(0)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtMergeTx, setBuiltMergeTx] = useState<Awaited<ReturnType<typeof buildMergeTx>> | null>(
    null
  )
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)

  useEffect(() => {
    if (nativeUtxos.length > 0 && feeUtxoIndex >= nativeUtxos.length) {
      setFeeUtxoIndex(nativeUtxos.length - 1)
    }
  }, [nativeUtxos.length, feeUtxoIndex])

  const selectedAssetId = useMemo(() => {
    const row = inputRows.find((r) => r.prevout != null)
    return row?.prevout?.asset?.trim() ?? null
  }, [inputRows])

  const getAvailableUtxosForRow = useCallback(
    (rowId: number) => {
      const selectedByOthers = new Set(
        inputRows
          .filter((r) => r.id !== rowId && r.txid && r.vout !== '')
          .map((r) => utxoKey(r.txid, parseInt(r.vout, 10)))
      )
      const base = assetUtxos.filter((u) => !selectedByOthers.has(utxoKey(u.txid, u.vout)))
      if (selectedAssetId == null) return base
      return base.filter((u) => sameAsset(u.asset, selectedAssetId))
    },
    [inputRows, assetUtxos, selectedAssetId]
  )

  const loadPrevoutForRowWithUtxo = useCallback(
    async (rowId: number, txid: string, vout: number) => {
      try {
        const tx = await esplora.getTx(txid)
        const v = tx.vout?.[vout]
        if (!v) {
          setInputRows((prev) =>
            prev.map((r) =>
              r.id === rowId ? { ...r, prevout: null, loadError: `No output at index ${vout}` } : r
            )
          )
          return
        }
        if (v.value == null) {
          setInputRows((prev) =>
            prev.map((r) =>
              r.id === rowId ? { ...r, prevout: null, loadError: 'Output is confidential' } : r
            )
          )
          return
        }
        setInputRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, prevout: v, loadError: null } : r))
        )
      } catch (e) {
        setInputRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? { ...r, prevout: null, loadError: e instanceof Error ? e.message : String(e) }
              : r
          )
        )
      }
    },
    [esplora]
  )

  const selectInputUtxo = useCallback(
    async (rowId: number, txid: string, vout: number) => {
      setInputRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, txid, vout: String(vout), prevout: null, loadError: null } : r
        )
      )
      await loadPrevoutForRowWithUtxo(rowId, txid, vout)
    },
    [loadPrevoutForRowWithUtxo]
  )

  const clearInputRow = useCallback((rowId: number) => {
    setInputRows((prev) =>
      prev.map((r) =>
        r.id === rowId ? { ...r, txid: '', vout: '', prevout: null, loadError: null } : r
      )
    )
  }, [])

  const addInputRow = useCallback(() => {
    const id = nextInputId
    setNextInputId((n) => n + 1)
    setInputRows((prev) => [...prev, { id, txid: '', vout: '', prevout: null, loadError: null }])
  }, [nextInputId])

  const removeInputRow = useCallback((id: number) => {
    setInputRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const addOutput = useCallback(() => {
    setOutputs((prev) => [...prev, { id: nextOutputId, address: accountAddress ?? '', amount: '' }])
    setNextOutputId((n) => n + 1)
  }, [nextOutputId, accountAddress])

  const removeOutput = useCallback((id: number) => {
    setOutputs((prev) => prev.filter((o) => o.id !== id))
  }, [])

  const updateOutput = useCallback((id: number, field: 'address' | 'amount', value: string) => {
    setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: value } : o)))
  }, [])

  const moveOutput = useCallback((index: number, dir: 1 | -1) => {
    setOutputs((prev) => {
      const i = index + dir
      if (i < 0 || i >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[i]] = [next[i], next[index]]
      return next
    })
  }, [])

  const handleClear = useCallback(() => {
    setInputRows([])
    setNextInputId(0)
    setFeeUtxoIndex(0)
    setFeeAmount('')
    setOutputs([])
    setNextOutputId(0)
    setBuildError(null)
    setBuiltMergeTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
  }, [])

  const totalInputValue = inputRows.reduce((sum, r) => sum + (r.prevout?.value ?? 0), 0)
  const feeNum = parseInt(feeAmount, 10) || 0
  const outputsSum = outputs.reduce((acc, o) => acc + (parseInt(o.amount, 10) || 0), 0)
  const changeAmount = totalInputValue - outputsSum

  const allInputsLoaded = inputRows.length > 0 && inputRows.every((r) => r.prevout != null)
  const feeUtxo = nativeUtxos[feeUtxoIndex]
  const canBuild =
    !!accountAddress &&
    !!seedHex &&
    allInputsLoaded &&
    selectedAssetId != null &&
    feeUtxo != null &&
    feeNum > 0 &&
    changeAmount >= 0 &&
    outputs.every((o) => o.address.trim() !== '' && (parseInt(o.amount, 10) || 0) > 0)

  const handleBuild = useCallback(async () => {
    if (!accountAddress || !selectedAssetId || !canBuild || !feeUtxo) return
    const inputs = inputRows
      .filter((r) => r.prevout != null)
      .map((r) => ({
        outpoint: { txid: r.txid.trim(), vout: parseInt(r.vout.trim(), 10) },
        prevout: r.prevout!,
      }))
    if (inputs.length === 0) return
    setBuildError(null)
    setBuiltMergeTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const tx = await esplora.getTx(feeUtxo.txid)
      const feePrevout = tx.vout?.[feeUtxo.vout] as EsploraVout | undefined
      if (!feePrevout || feePrevout.value == null) {
        setBuildError('Failed to load fee UTXO prevout')
        setBuilding(false)
        return
      }
      const feeInput = {
        outpoint: { txid: feeUtxo.txid, vout: feeUtxo.vout },
        prevout: feePrevout,
      }
      const outputList: MergeTxOutput[] = outputs.map((o) => ({
        address: o.address.trim(),
        amount: BigInt(parseInt(o.amount, 10) || 0),
        assetId: selectedAssetId,
      }))
      if (changeAmount > 0) {
        outputList.push({
          address: accountAddress,
          amount: BigInt(changeAmount),
          assetId: selectedAssetId,
        })
      }
      const lbtcChange = feePrevout.value - feeNum
      if (lbtcChange > 0) {
        outputList.push({
          address: accountAddress,
          amount: BigInt(lbtcChange),
        })
      }
      const result = await buildMergeTx({
        inputs,
        outputs: outputList,
        feeAmount: BigInt(feeNum),
        network: P2PK_NETWORK,
        feeInput,
      })
      setBuiltMergeTx(result)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [
    accountAddress,
    selectedAssetId,
    canBuild,
    feeUtxo,
    inputRows,
    outputs,
    feeNum,
    esplora,
    changeAmount,
  ])

  const handleSign = useCallback(async () => {
    if (!builtMergeTx || !seedHex || !accountAddress) return
    setBuildError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizeMergeTx({
        pset: builtMergeTx.pset as PsetWithExtractTx,
        prevouts: builtMergeTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [builtMergeTx, seedHex, accountAddress, accountIndex])

  const handleBuildAndBroadcast = useCallback(async () => {
    if (!builtMergeTx || !seedHex || !accountAddress || !canBuild) return
    setBuildError(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizeMergeTx({
        pset: builtMergeTx.pset as PsetWithExtractTx,
        prevouts: builtMergeTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
      const txidRes = await esplora.broadcastTx(hex)
      setBroadcastTxid(txidRes)
      setBroadcastError(null)
    } catch (e) {
      if (e instanceof EsploraApiError) {
        setBroadcastError(formatBroadcastError(e.body ?? e.message))
        setBroadcastTxid(null)
      } else {
        setBuildError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBuilding(false)
    }
  }, [builtMergeTx, seedHex, accountAddress, accountIndex, canBuild, esplora])

  const clearBroadcastState = useCallback(() => {
    setBroadcastTxid(null)
    setBroadcastError(null)
  }, [])

  return {
    assetUtxos,
    nativeUtxos,
    selectedAssetId,
    getAvailableUtxosForRow,
    selectInputUtxo,
    clearInputRow,
    inputRows,
    addInputRow,
    removeInputRow,
    feeUtxoIndex,
    setFeeUtxoIndex,
    feeAmount,
    setFeeAmount,
    outputs,
    addOutput,
    removeOutput,
    updateOutput,
    moveOutput,
    buildError,
    builtMergeTx,
    signedTxHex,
    building,
    broadcastTxid,
    broadcastError,
    handleBuild,
    handleSign,
    handleBuildAndBroadcast,
    handleClear,
    clearBroadcastState,
    totalInputValue,
    outputsSum,
    changeAmount,
    canBuild,
  }
}
