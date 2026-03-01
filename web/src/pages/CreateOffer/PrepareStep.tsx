/**
 * Step 1: Prepare 4 UTXOs for Utility NFTs issuance.
 * One LBTC input with issuance → 4×10 of new asset to address + change + fee.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { EsploraApiError, type EsploraClient } from '../../api/esplora'
import { formatBroadcastError } from '../../utils/parseBroadcastError'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import type { PsetWithExtractTx } from '../../simplicity'
import {
  buildPrepareUtilityNftsTx,
  finalizePrepareUtilityNftsTx,
} from '../../tx/prepareUtilityNfts/buildPrepareUtilityNftsTx'
import { BroadcastStatusContent } from '../../components/PostBroadcastModal'
import { getBroadcastSuccessMessage } from '../../components/broadcastSuccessMessages'
import { CopyIcon } from '../../components/CopyIcon'
import {
  ButtonPrimary,
  ButtonSecondary,
  ButtonIconNeutral,
  ButtonNeutral,
} from '../../components/Button'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'

export interface PrepareStepProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  existingPreparedTxid?: string | null
  onClearSavedPrepare?: () => void
  onSuccess: (txid: string, auxiliaryAssetId?: string, issuanceEntropyHex?: string) => void
}

export function PrepareStep({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  existingPreparedTxid,
  onClearSavedPrepare,
  onSuccess,
}: PrepareStepProps) {
  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const [selectedUtxoIndex, setSelectedUtxoIndex] = useState<number>(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [toAddress, setToAddress] = useState(accountAddress ?? '')
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtPrepareTx, setBuiltPrepareTx] = useState<Awaited<
    ReturnType<typeof buildPrepareUtilityNftsTx>
  > | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)

  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (buildError || broadcastError || signedTxHex) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [buildError, broadcastError, signedTxHex])

  const selectedUtxo =
    nativeUtxos.length > 0 && selectedUtxoIndex >= 0 && selectedUtxoIndex < nativeUtxos.length
      ? nativeUtxos[selectedUtxoIndex]
      : null

  const feeNum = parseInt(feeAmount, 10) || 0
  const minFeeUtxoValue = feeNum
  const canBuild =
    selectedUtxo != null &&
    (selectedUtxo.value ?? 0) >= minFeeUtxoValue &&
    feeNum > 0 &&
    toAddress.trim().length > 0

  const handleBuild = useCallback(async () => {
    if (!selectedUtxo || !canBuild) return
    setBuildError(null)
    setBuiltPrepareTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const tx = await esplora.getTx(selectedUtxo.txid)
      const prevout = tx.vout?.[selectedUtxo.vout]
      if (!prevout) {
        setBuildError(`No output at index ${selectedUtxo.vout}`)
        return
      }
      if (prevout.value == null) {
        setBuildError('Output is confidential (value not exposed)')
        return
      }
      const result = await buildPrepareUtilityNftsTx({
        feeUtxo: {
          outpoint: { txid: selectedUtxo.txid, vout: selectedUtxo.vout },
          prevout,
        },
        toAddress: toAddress.trim(),
        feeAmount: BigInt(feeNum),
        network: P2PK_NETWORK,
      })
      setBuiltPrepareTx(result)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [selectedUtxo, canBuild, toAddress, feeNum, esplora])

  const handleSign = useCallback(async () => {
    if (!builtPrepareTx || !seedHex) return
    setBuildError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizePrepareUtilityNftsTx({
        pset: builtPrepareTx.pset as PsetWithExtractTx,
        prevouts: builtPrepareTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(hex)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [builtPrepareTx, seedHex, accountIndex])

  const handleBuildAndBroadcast = useCallback(async () => {
    if (!builtPrepareTx || !seedHex || !selectedUtxo || !canBuild) return
    setBuildError(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const hex = await finalizePrepareUtilityNftsTx({
        pset: builtPrepareTx.pset as PsetWithExtractTx,
        prevouts: builtPrepareTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      const txidRes = await esplora.broadcastTx(hex)
      setBroadcastTxid(txidRes)
      setSignedTxHex(hex)
      onSuccess(txidRes, builtPrepareTx.auxiliaryAssetId, builtPrepareTx.issuanceEntropyHex)
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
  }, [builtPrepareTx, seedHex, accountIndex, selectedUtxo, canBuild, esplora, onSuccess])

  const showAlreadyPrepared = Boolean(existingPreparedTxid?.trim())

  const handlePostBroadcastClose = () => {
    onSuccess(broadcastTxid!, builtPrepareTx?.auxiliaryAssetId, builtPrepareTx?.issuanceEntropyHex)
    setBroadcastTxid(null)
  }

  if (broadcastTxid) {
    return (
      <section className="min-w-0 max-w-4xl">
        <BroadcastStatusContent
          txid={broadcastTxid}
          successMessage={getBroadcastSuccessMessage('prepare')}
          esplora={esplora}
          onClose={handlePostBroadcastClose}
        />
      </section>
    )
  }

  return (
    <section className="min-w-0 max-w-4xl">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Step 1: Prepare 4 UTXOs</h3>
      <div className="space-y-4 text-sm">
        {showAlreadyPrepared && (
          <div className="p-4 rounded-lg border border-green-200 bg-green-50 text-green-900">
            <p className="font-medium mb-1">Already prepared for this account</p>
            <p className="text-green-800 mb-2">
              Use Step 2; the 4 issuance UTXOs are vouts 0, 1, 2, 3 of this transaction.
            </p>
            <p className="flex flex-wrap items-center gap-1.5 mb-3">
              <a
                href={esplora.getTxExplorerUrl(existingPreparedTxid!)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-green-800 hover:underline underline-offset-1"
              >
                {existingPreparedTxid}
              </a>
              <ButtonIconNeutral
                onClick={() => navigator.clipboard?.writeText(existingPreparedTxid!)}
                title="Copy txid"
                aria-label="Copy txid"
              >
                <CopyIcon className="h-4 w-4" />
              </ButtonIconNeutral>
            </p>
            <ButtonSecondary size="md" onClick={onClearSavedPrepare}>
              Prepare again
            </ButtonSecondary>
          </div>
        )}

        {!showAlreadyPrepared && (
          <>
            <div>
              <p className={formClassNames.label}>Fee UTXO (LBTC)</p>
              {nativeUtxos.length === 0 ? (
                <p className="text-gray-500">
                  No LBTC UTXOs in your account. Use Utility to create some.
                </p>
              ) : (
                <UtxoSelect
                  className="w-full max-w-md"
                  utxos={nativeUtxos}
                  value={String(selectedUtxoIndex)}
                  onChange={(v) => setSelectedUtxoIndex(parseInt(v, 10))}
                  optionValueType="index"
                  labelSuffix="sats"
                />
              )}
            </div>

            <div>
              <p className={formClassNames.label}>Fee amount (sats)</p>
              <Input
                type="number"
                placeholder="e.g. 500"
                min={1}
                className="w-28"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
              />
            </div>

            <div>
              <p className={formClassNames.label}>To address (4×10 new asset + change)</p>
              <Input
                type="text"
                placeholder="Bech32m address"
                className="w-full max-w-lg font-mono"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
              />
              {accountAddress && (
                <p className={formClassNames.helper}>
                  Default: current account. Fee UTXO must have at least {minFeeUtxoValue} sats
                  (fee). Prep creates 4×10 of a new asset to this address.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <ButtonSecondary size="md" disabled={!canBuild || building} onClick={handleBuild}>
                {building ? 'Building…' : 'Build'}
              </ButtonSecondary>
              <ButtonSecondary
                size="md"
                disabled={!builtPrepareTx || building}
                onClick={handleSign}
              >
                {building ? 'Signing…' : 'Sign'}
              </ButtonSecondary>
              <ButtonPrimary
                size="md"
                disabled={!builtPrepareTx || building}
                onClick={handleBuildAndBroadcast}
              >
                {building ? 'Signing…' : 'Sign & Broadcast'}
              </ButtonPrimary>
            </div>

            {builtPrepareTx && !signedTxHex && !broadcastTxid && (
              <p className="text-blue-700 text-sm">
                Transaction built. Click Sign or Sign & Broadcast.
              </p>
            )}

            {buildError && <p className="text-red-600 mt-2">{buildError}</p>}
            {broadcastError && <p className="text-red-600 mt-2">{broadcastError}</p>}

            {signedTxHex && (
              <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
                <p className="font-medium text-gray-700 mb-1">Signed transaction (hex)</p>
                <textarea
                  readOnly
                  className="w-full font-mono text-xs text-gray-900 bg-white border border-gray-200 rounded p-2 h-24"
                  value={signedTxHex}
                />
                <ButtonNeutral
                  size="sm"
                  className="mt-2"
                  onClick={() => navigator.clipboard?.writeText(signedTxHex)}
                >
                  Copy hex
                </ButtonNeutral>
              </div>
            )}
            <div ref={bottomAnchorRef} aria-hidden="true" />
          </>
        )}
      </div>
    </section>
  )
}
