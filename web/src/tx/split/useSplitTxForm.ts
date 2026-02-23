/**
 * Form state and handlers for building a split (one-in, many-out + change + fee) transaction.
 */

import { useCallback, useEffect, useState } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { P2PK_NETWORK } from '../../utility/addressP2pk'
import type { EsploraClient } from '../../api/esplora'
import type { EsploraVout } from '../../api/esplora'
import { buildSplitTx } from './buildSplitTx'
import { computeChange, canBuildSplit } from './validation'
import type { TxOutputRow } from './types'

export interface UseSplitTxFormParams {
  esplora: EsploraClient
  accountAddress: string | null
  seedHex: string | null
  accountIndex: number
  outpointTxid: string
  outpointVout: string
  /** Setters are used by the parent (e.g. when user selects a UTXO); hook only reads values. */
  setOutpointTxid: (s: string) => void
  setOutpointVout: (s: string) => void
}

export interface UseSplitTxFormResult {
  loadedPrevout: EsploraVout | null
  loadError: string | null
  feeAmount: string
  setFeeAmount: (s: string) => void
  outputs: TxOutputRow[]
  nextId: number
  addOutput: () => void
  removeOutput: (id: number) => void
  updateOutput: (id: number, field: 'address' | 'amount', value: string) => void
  moveOutput: (index: number, dir: 1 | -1) => void
  buildError: string | null
  signedTxHex: string | null
  building: boolean
  loadPrevout: () => Promise<void>
  handleBuild: () => Promise<void>
  inputValue: number
  feeNum: number
  outputsSum: number
  changeAmount: number
  validAmounts: boolean
  canBuild: boolean
}

export function useSplitTxForm({
  esplora,
  accountAddress,
  seedHex,
  accountIndex,
  outpointTxid,
  outpointVout,
  // Setters used by parent; hook only reads outpointTxid/outpointVout
  setOutpointTxid: _setOutpointTxid, // eslint-disable-line @typescript-eslint/no-unused-vars
  setOutpointVout: _setOutpointVout, // eslint-disable-line @typescript-eslint/no-unused-vars
}: UseSplitTxFormParams): UseSplitTxFormResult {
  const [loadedPrevout, setLoadedPrevout] = useState<EsploraVout | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feeAmount, setFeeAmount] = useState('')
  const [outputs, setOutputs] = useState<TxOutputRow[]>([])
  const [nextId, setNextId] = useState(0)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    setLoadedPrevout(null)
    setLoadError(null)
  }, [outpointTxid, outpointVout])

  const loadPrevout = useCallback(async () => {
    const txid = outpointTxid.trim()
    const vout = parseInt(outpointVout.trim(), 10)
    if (!txid || Number.isNaN(vout) || vout < 0) {
      setLoadError('Enter valid txid and vout')
      setLoadedPrevout(null)
      return
    }
    setLoadError(null)
    setLoadedPrevout(null)
    try {
      const tx = await esplora.getTx(txid)
      const v = tx.vout?.[vout]
      if (!v) {
        setLoadError(`No output at index ${vout}`)
        return
      }
      if (v.value == null) {
        setLoadError('Output is confidential (value not exposed)')
        return
      }
      setLoadedPrevout(v)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [esplora, outpointTxid, outpointVout])

  const addOutput = useCallback(() => {
    setOutputs((prev) => [...prev, { id: nextId, address: accountAddress ?? '', amount: '' }])
    setNextId((n) => n + 1)
  }, [nextId, accountAddress])

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

  const inputValue = loadedPrevout?.value ?? 0
  const feeNum = parseInt(feeAmount, 10) || 0
  const outputsSum = outputs.reduce((acc, o) => acc + (parseInt(o.amount, 10) || 0), 0)
  const changeAmount = computeChange(inputValue, feeNum, outputsSum)
  const validAmounts =
    loadedPrevout != null &&
    feeNum >= 0 &&
    changeAmount >= 0 &&
    outputs.every((o) => (parseInt(o.amount, 10) || 0) >= 0)
  const canBuild = canBuildSplit(loadedPrevout, feeNum, changeAmount, outputs, accountAddress)

  const handleBuild = useCallback(async () => {
    if (!seedHex || !accountAddress || !loadedPrevout || !canBuild) return
    setBuildError(null)
    setSignedTxHex(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const txid = outpointTxid.trim()
      const vout = parseInt(outpointVout.trim(), 10)
      const hex = await buildSplitTx({
        outpoint: { txid, vout },
        prevout: loadedPrevout,
        outputs: outputs.map((o) => ({
          address: o.address.trim(),
          amount: BigInt(parseInt(o.amount, 10) || 0),
        })),
        change:
          changeAmount > 0 && accountAddress
            ? { address: accountAddress, amount: BigInt(changeAmount) }
            : null,
        feeAmount: BigInt(feeNum),
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [
    seedHex,
    accountIndex,
    accountAddress,
    loadedPrevout,
    canBuild,
    outpointTxid,
    outpointVout,
    outputs,
    feeNum,
    changeAmount,
  ])

  return {
    loadedPrevout,
    loadError,
    feeAmount,
    setFeeAmount,
    outputs,
    nextId,
    addOutput,
    removeOutput,
    updateOutput,
    moveOutput,
    buildError,
    signedTxHex,
    building,
    loadPrevout,
    handleBuild,
    inputValue,
    feeNum,
    outputsSum,
    changeAmount,
    validAmounts,
    canBuild,
  }
}
