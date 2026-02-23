/**
 * Form state for split-asset tx: two inputs (fee LBTC + asset), outputs in asset, two changes.
 */

import { useCallback, useEffect, useState } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import type { EsploraClient } from '../../api/esplora'
import type { EsploraVout } from '../../api/esplora'
import { buildAndSignSplitAssetTx } from '../../utility/buildSplitAssetTx'
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
  signedTxHex: string | null
  building: boolean
  handleBuild: () => Promise<void>
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
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

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
    if (!seedHex || !accountAddress || !loadedPrevoutFee || !loadedPrevoutAsset || !canBuild) return
    setBuildError(null)
    setSignedTxHex(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const txidFee = outpointFeeTxid.trim()
      const voutFee = parseInt(outpointFeeVout.trim(), 10)
      const txidAsset = outpointAssetTxid.trim()
      const voutAsset = parseInt(outpointAssetVout.trim(), 10)
      const hex = await buildAndSignSplitAssetTx({
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
    signedTxHex,
    building,
    handleBuild,
    feeValue,
    assetValue,
    outputsSum,
    changeLbtc,
    changeAsset,
    canBuild,
  }
}
