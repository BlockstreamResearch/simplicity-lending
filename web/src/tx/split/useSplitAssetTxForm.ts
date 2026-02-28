/**
 * Form state for split-asset tx: two inputs (fee LBTC + asset), outputs in asset, two changes.
 */

import { useCallback, useEffect, useState } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { EsploraApiError, type EsploraClient, type EsploraVout } from '../../api/esplora'
import type { PsetWithExtractTx } from '../../simplicity'
import { buildSplitAssetTx, finalizeSplitAssetTx } from './buildSplitAssetTx'
import type { TxOutputRow } from './types'

export interface UseSplitAssetTxFormParams {
  esplora: EsploraClient
  accountAddress: string | null
  seedHex: string | null
  accountIndex: number
  /** When provided with setters, outpoint fields are controlled from parent (e.g. UTXO table click). */
  outpointFeeTxid?: string
  outpointFeeVout?: string
  setOutpointFeeTxid?: (s: string) => void
  setOutpointFeeVout?: (s: string) => void
  outpointAssetTxid?: string
  outpointAssetVout?: string
  setOutpointAssetTxid?: (s: string) => void
  setOutpointAssetVout?: (s: string) => void
  /** Called after a successful broadcast (e.g. to refresh UTXOs). */
  onBroadcastSuccess?: () => void
}

export interface UseSplitAssetTxFormResult {
  outpointFeeTxid: string
  outpointFeeVout: string
  setOutpointFeeTxid: (s: string) => void
  setOutpointFeeVout: (s: string) => void
  outpointAssetTxid: string
  outpointAssetVout: string
  setOutpointAssetTxid: (s: string) => void
  setOutpointAssetVout: (s: string) => void
  loadedPrevoutFee: EsploraVout | null
  loadedPrevoutAsset: EsploraVout | null
  loadErrorFee: string | null
  loadErrorAsset: string | null
  loadPrevoutFee: () => Promise<void>
  loadPrevoutAsset: () => Promise<void>
  feeAmount: string
  setFeeAmount: (s: string) => void
  outputs: TxOutputRow[]
  addOutput: () => void
  removeOutput: (id: number) => void
  updateOutput: (id: number, field: 'address' | 'amount', value: string) => void
  moveOutput: (index: number, dir: 1 | -1) => void
  buildError: string | null
  /** Set after Build (unsigned). Sign / Sign & Broadcast use this. */
  builtSplitAssetTx: Awaited<ReturnType<typeof buildSplitAssetTx>> | null
  signedTxHex: string | null
  building: boolean
  broadcastTxid: string | null
  broadcastError: string | null
  handleBuild: () => Promise<void>
  handleSign: () => Promise<void>
  handleBuildAndBroadcast: () => Promise<void>
  handleClear: () => void
  feeValue: number
  assetValue: number
  outputsSum: number
  changeLbtc: number
  changeAsset: number
  canBuild: boolean
}

export function useSplitAssetTxForm({
  esplora,
  accountAddress,
  seedHex,
  accountIndex,
  outpointFeeTxid: outpointFeeTxidProp,
  outpointFeeVout: outpointFeeVoutProp,
  setOutpointFeeTxid: setOutpointFeeTxidProp,
  setOutpointFeeVout: setOutpointFeeVoutProp,
  outpointAssetTxid: outpointAssetTxidProp,
  outpointAssetVout: outpointAssetVoutProp,
  setOutpointAssetTxid: setOutpointAssetTxidProp,
  setOutpointAssetVout: setOutpointAssetVoutProp,
  onBroadcastSuccess,
}: UseSplitAssetTxFormParams): UseSplitAssetTxFormResult {
  const [internalFeeTxid, setInternalFeeTxid] = useState('')
  const [internalFeeVout, setInternalFeeVout] = useState('')
  const [internalAssetTxid, setInternalAssetTxid] = useState('')
  const [internalAssetVout, setInternalAssetVout] = useState('')

  const outpointFeeTxid = outpointFeeTxidProp !== undefined ? outpointFeeTxidProp : internalFeeTxid
  const setOutpointFeeTxid = setOutpointFeeTxidProp ?? setInternalFeeTxid
  const outpointFeeVout = outpointFeeVoutProp !== undefined ? outpointFeeVoutProp : internalFeeVout
  const setOutpointFeeVout = setOutpointFeeVoutProp ?? setInternalFeeVout
  const outpointAssetTxid =
    outpointAssetTxidProp !== undefined ? outpointAssetTxidProp : internalAssetTxid
  const setOutpointAssetTxid = setOutpointAssetTxidProp ?? setInternalAssetTxid
  const outpointAssetVout =
    outpointAssetVoutProp !== undefined ? outpointAssetVoutProp : internalAssetVout
  const setOutpointAssetVout = setOutpointAssetVoutProp ?? setInternalAssetVout
  const [loadedPrevoutFee, setLoadedPrevoutFee] = useState<EsploraVout | null>(null)
  const [loadedPrevoutAsset, setLoadedPrevoutAsset] = useState<EsploraVout | null>(null)
  const [loadErrorFee, setLoadErrorFee] = useState<string | null>(null)
  const [loadErrorAsset, setLoadErrorAsset] = useState<string | null>(null)
  const [feeAmount, setFeeAmount] = useState('')
  const [outputs, setOutputs] = useState<TxOutputRow[]>([])
  const [nextId, setNextId] = useState(0)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtSplitAssetTx, setBuiltSplitAssetTx] = useState<Awaited<
    ReturnType<typeof buildSplitAssetTx>
  > | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)

  const handleClear = useCallback(() => {
    setOutpointFeeTxid('')
    setOutpointFeeVout('')
    setOutpointAssetTxid('')
    setOutpointAssetVout('')
    setLoadedPrevoutFee(null)
    setLoadedPrevoutAsset(null)
    setLoadErrorFee(null)
    setLoadErrorAsset(null)
    setFeeAmount('')
    setOutputs([])
    setNextId(0)
    setBuildError(null)
    setBuiltSplitAssetTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
  }, [setOutpointFeeTxid, setOutpointFeeVout, setOutpointAssetTxid, setOutpointAssetVout])

  useEffect(() => {
    setLoadedPrevoutFee(null)
    setLoadErrorFee(null)
  }, [outpointFeeTxid, outpointFeeVout])

  useEffect(() => {
    setLoadedPrevoutAsset(null)
    setLoadErrorAsset(null)
  }, [outpointAssetTxid, outpointAssetVout])

  const loadPrevoutFee = useCallback(async () => {
    const txid = outpointFeeTxid.trim()
    const vout = parseInt(outpointFeeVout.trim(), 10)
    if (!txid || Number.isNaN(vout) || vout < 0) {
      setLoadErrorFee('Enter valid txid and vout')
      setLoadedPrevoutFee(null)
      return
    }
    setLoadErrorFee(null)
    setLoadedPrevoutFee(null)
    try {
      const tx = await esplora.getTx(txid)
      const v = tx.vout?.[vout]
      if (!v) {
        setLoadErrorFee(`No output at index ${vout}`)
        return
      }
      if (v.value == null) {
        setLoadErrorFee('Output is confidential (value not exposed)')
        return
      }
      setLoadedPrevoutFee(v)
    } catch (e) {
      setLoadErrorFee(e instanceof Error ? e.message : String(e))
    }
  }, [esplora, outpointFeeTxid, outpointFeeVout])

  const loadPrevoutAsset = useCallback(async () => {
    const txid = outpointAssetTxid.trim()
    const vout = parseInt(outpointAssetVout.trim(), 10)
    if (!txid || Number.isNaN(vout) || vout < 0) {
      setLoadErrorAsset('Enter valid txid and vout')
      setLoadedPrevoutAsset(null)
      return
    }
    setLoadErrorAsset(null)
    setLoadedPrevoutAsset(null)
    try {
      const tx = await esplora.getTx(txid)
      const v = tx.vout?.[vout]
      if (!v) {
        setLoadErrorAsset(`No output at index ${vout}`)
        return
      }
      if (v.value == null) {
        setLoadErrorAsset('Output is confidential (value not exposed)')
        return
      }
      const assetHex = v.asset?.trim().toLowerCase()
      if (!assetHex) {
        setLoadErrorAsset('Select an asset UTXO (this output has no asset id)')
        return
      }
      if (assetHex === POLICY_ASSET_ID[P2PK_NETWORK]) {
        setLoadErrorAsset('Select an asset UTXO (not LBTC)')
        return
      }
      setLoadedPrevoutAsset(v)
    } catch (e) {
      setLoadErrorAsset(e instanceof Error ? e.message : String(e))
    }
  }, [esplora, outpointAssetTxid, outpointAssetVout])

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

  const feeValue = loadedPrevoutFee?.value ?? 0
  const assetValue = loadedPrevoutAsset?.value ?? 0
  const feeNum = parseInt(feeAmount, 10) || 0
  const outputsSum = outputs.reduce((acc, o) => acc + (parseInt(o.amount, 10) || 0), 0)
  const changeLbtc = feeValue - feeNum
  const changeAsset = assetValue - outputsSum

  const canBuild =
    !!accountAddress &&
    !!seedHex &&
    !!loadedPrevoutFee &&
    !!loadedPrevoutAsset &&
    loadedPrevoutAsset.asset != null &&
    feeNum >= 0 &&
    changeLbtc >= 0 &&
    changeAsset >= 0 &&
    outputs.every((o) => o.address.trim() !== '' && (parseInt(o.amount, 10) || 0) > 0)

  const handleBuild = useCallback(async () => {
    if (!accountAddress || !loadedPrevoutFee || !loadedPrevoutAsset || !canBuild) return
    setBuildError(null)
    setBuiltSplitAssetTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const txidFee = outpointFeeTxid.trim()
      const voutFee = parseInt(outpointFeeVout.trim(), 10)
      const txidAsset = outpointAssetTxid.trim()
      const voutAsset = parseInt(outpointAssetVout.trim(), 10)
      const result = await buildSplitAssetTx({
        feeInput: {
          outpoint: { txid: txidFee, vout: voutFee },
          prevout: loadedPrevoutFee,
        },
        assetInput: {
          outpoint: { txid: txidAsset, vout: voutAsset },
          prevout: loadedPrevoutAsset,
        },
        outputs: outputs.map((o) => ({
          address: o.address.trim(),
          amount: BigInt(parseInt(o.amount, 10) || 0),
        })),
        changeAsset:
          changeAsset > 0 ? { address: accountAddress, amount: BigInt(changeAsset) } : null,
        changeLbtc: changeLbtc > 0 ? { address: accountAddress, amount: BigInt(changeLbtc) } : null,
        feeAmount: BigInt(feeNum),
        network: P2PK_NETWORK,
      })
      setBuiltSplitAssetTx(result)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [
    accountAddress,
    loadedPrevoutFee,
    loadedPrevoutAsset,
    canBuild,
    outpointFeeTxid,
    outpointFeeVout,
    outpointAssetTxid,
    outpointAssetVout,
    outputs,
    changeAsset,
    changeLbtc,
    feeNum,
  ])

  const handleSign = useCallback(async () => {
    if (!builtSplitAssetTx || !seedHex || !accountAddress) return
    setBuildError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizeSplitAssetTx({
        pset: builtSplitAssetTx.pset as PsetWithExtractTx,
        prevouts: builtSplitAssetTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [builtSplitAssetTx, seedHex, accountAddress, accountIndex])

  const handleBuildAndBroadcast = useCallback(async () => {
    if (!builtSplitAssetTx || !seedHex || !accountAddress || !canBuild) return
    setBuildError(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizeSplitAssetTx({
        pset: builtSplitAssetTx.pset as PsetWithExtractTx,
        prevouts: builtSplitAssetTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
      const txidRes = await esplora.broadcastTx(hex)
      setBroadcastTxid(txidRes)
      setBroadcastError(null)
      onBroadcastSuccess?.()
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
    builtSplitAssetTx,
    seedHex,
    accountIndex,
    accountAddress,
    canBuild,
    onBroadcastSuccess,
    esplora,
  ])

  return {
    outpointFeeTxid,
    outpointFeeVout,
    setOutpointFeeTxid,
    setOutpointFeeVout,
    outpointAssetTxid,
    outpointAssetVout,
    setOutpointAssetTxid,
    setOutpointAssetVout,
    loadedPrevoutFee,
    loadedPrevoutAsset,
    loadErrorFee,
    loadErrorAsset,
    loadPrevoutFee,
    loadPrevoutAsset,
    feeAmount,
    setFeeAmount,
    outputs,
    addOutput,
    removeOutput,
    updateOutput,
    moveOutput,
    buildError,
    builtSplitAssetTx,
    signedTxHex,
    building,
    broadcastTxid,
    broadcastError,
    handleBuild,
    handleSign,
    handleBuildAndBroadcast,
    handleClear,
    feeValue,
    assetValue,
    outputsSum,
    changeLbtc,
    changeAsset,
    canBuild,
  }
}
