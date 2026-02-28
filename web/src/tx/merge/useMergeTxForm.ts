/**
 * Form state for merge tx: multiple inputs (select from native UTXOs via dropdown), outputs, fee.
 * Merge Native: only LBTC UTXOs; no duplicate selection per input.
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
import { formatBroadcastError } from '../../utils/parseBroadcastError'
import type { PsetWithExtractTx } from '../../simplicity'
import { buildMergeTx, finalizeMergeTx } from './buildMergeTx'
import type { TxOutputRow } from '../split/types'

export interface MergeInputRow {
  id: number
  txid: string
  vout: string
  prevout: EsploraVout | null
  loadError: string | null
}

export interface UseMergeTxFormParams {
  esplora: EsploraClient
  accountAddress: string | null
  seedHex: string | null
  accountIndex: number
  /** Account UTXOs; only native (LBTC) are offered in input dropdowns. */
  utxos: ScripthashUtxoEntry[]
}

export interface UseMergeTxFormResult {
  /** Only LBTC UTXOs (policy asset), for dropdown options. */
  nativeUtxos: ScripthashUtxoEntry[]
  /** UTXOs available for this row (native minus already selected in other rows). */
  getAvailableUtxosForRow: (rowId: number) => ScripthashUtxoEntry[]
  /** Set row input from dropdown selection and load prevout. */
  selectInputUtxo: (rowId: number, txid: string, vout: number) => Promise<void>
  /** Clear selected UTXO for a row. */
  clearInputRow: (rowId: number) => void
  inputRows: MergeInputRow[]
  addInputRow: () => void
  removeInputRow: (id: number) => void
  updateInputRow: (id: number, field: 'txid' | 'vout', value: string) => void
  loadPrevoutForRow: (id: number) => Promise<void>
  feeAmount: string
  setFeeAmount: (s: string) => void
  outputs: TxOutputRow[]
  addOutput: () => void
  removeOutput: (id: number) => void
  updateOutput: (id: number, field: 'address' | 'amount', value: string) => void
  moveOutput: (index: number, dir: 1 | -1) => void
  buildError: string | null
  /** Set after Build (unsigned). Sign / Sign & Broadcast use this. */
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

function utxoKey(txid: string, vout: number): string {
  return `${txid}:${vout}`
}

export function useMergeTxForm({
  esplora,
  accountAddress,
  seedHex,
  accountIndex,
  utxos,
}: UseMergeTxFormParams): UseMergeTxFormResult {
  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const [nextInputId, setNextInputId] = useState(0)
  const [inputRows, setInputRows] = useState<MergeInputRow[]>([])
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

  const handleClear = useCallback(() => {
    setInputRows([])
    setNextInputId(0)
    setFeeAmount('')
    setOutputs([])
    setNextOutputId(0)
    setBuildError(null)
    setBuiltMergeTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
  }, [])

  const getAvailableUtxosForRow = useCallback(
    (rowId: number) => {
      const selectedByOthers = new Set(
        inputRows
          .filter((r) => r.id !== rowId && r.txid && r.vout !== '')
          .map((r) => utxoKey(r.txid, parseInt(r.vout, 10)))
      )
      return nativeUtxos.filter((u) => !selectedByOthers.has(utxoKey(u.txid, u.vout)))
    },
    [inputRows, nativeUtxos]
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

  const updateInputRow = useCallback((id: number, field: 'txid' | 'vout', value: string) => {
    setInputRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value, loadError: null } : r))
    )
  }, [])

  const loadPrevoutForRow = useCallback(
    async (id: number) => {
      const row = inputRows.find((r) => r.id === id)
      if (!row) return
      const txid = row.txid.trim()
      const vout = parseInt(row.vout.trim(), 10)
      if (!txid || Number.isNaN(vout) || vout < 0) {
        setInputRows((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, prevout: null, loadError: 'Enter valid txid and vout' } : r
          )
        )
        return
      }
      setInputRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, prevout: null, loadError: null } : r))
      )
      try {
        const tx = await esplora.getTx(txid)
        const v = tx.vout?.[vout]
        if (!v) {
          setInputRows((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, prevout: null, loadError: `No output at index ${vout}` } : r
            )
          )
          return
        }
        if (v.value == null) {
          setInputRows((prev) =>
            prev.map((r) =>
              r.id === id ? { ...r, prevout: null, loadError: 'Output is confidential' } : r
            )
          )
          return
        }
        setInputRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, prevout: v, loadError: null } : r))
        )
      } catch (e) {
        setInputRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, prevout: null, loadError: e instanceof Error ? e.message : String(e) }
              : r
          )
        )
      }
    },
    [esplora, inputRows]
  )

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

  const totalInputValue = inputRows.reduce((sum, r) => sum + (r.prevout?.value ?? 0), 0)
  const feeNum = parseInt(feeAmount, 10) || 0
  const outputsSum = outputs.reduce((acc, o) => acc + (parseInt(o.amount, 10) || 0), 0)
  const changeAmount = totalInputValue - feeNum - outputsSum

  const allInputsLoaded = inputRows.length > 0 && inputRows.every((r) => r.prevout != null)
  const canBuild =
    !!accountAddress &&
    !!seedHex &&
    allInputsLoaded &&
    feeNum >= 0 &&
    changeAmount >= 0 &&
    outputs.every((o) => o.address.trim() !== '' && (parseInt(o.amount, 10) || 0) > 0)

  const handleBuild = useCallback(async () => {
    if (!accountAddress || !canBuild) return
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
      const result = await buildMergeTx({
        inputs,
        outputs: outputs.map((o) => ({
          address: o.address.trim(),
          amount: BigInt(parseInt(o.amount, 10) || 0),
        })),
        feeAmount: BigInt(feeNum),
        network: P2PK_NETWORK,
      })
      setBuiltMergeTx(result)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [accountAddress, canBuild, inputRows, outputs, feeNum])

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
    nativeUtxos,
    getAvailableUtxosForRow,
    selectInputUtxo,
    clearInputRow,
    inputRows,
    addInputRow,
    removeInputRow,
    updateInputRow,
    loadPrevoutForRow,
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
