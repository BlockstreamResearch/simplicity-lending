/**
 * Merge Asset tx builder: multiple inputs (same asset), outputs in that asset, fee in LBTC.
 * After first UTXO is selected, only UTXOs of that asset are shown.
 */

import { useRef, useEffect } from 'react'
import { useMergeAssetTxForm } from '../../tx/merge/useMergeAssetTxForm'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { PostBroadcastModal } from '../../components/PostBroadcastModal'
import { getBroadcastSuccessMessage } from '../../components/broadcastSuccessMessages'
import { ButtonPrimary, ButtonSecondary, ButtonNeutral } from '../../components/Button'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'

function shortAssetId(assetId: string, head = 8, tail = 4): string {
  if (assetId.length <= head + tail) return assetId
  return `${assetId.slice(0, head)}…${assetId.slice(-tail)}`
}

export interface MergeAssetTxBuilderProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string | null
  onBroadcastSuccess?: () => void
}

export function MergeAssetTxBuilder({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  onBroadcastSuccess,
}: MergeAssetTxBuilderProps) {
  const form = useMergeAssetTxForm({
    esplora,
    accountAddress,
    seedHex,
    accountIndex,
    utxos,
  })

  const {
    getAvailableUtxosForRow,
    selectInputUtxo,
    clearInputRow,
    inputRows,
    addInputRow,
    removeInputRow,
    selectedAssetId,
    feeUtxoIndex,
    setFeeUtxoIndex,
    feeAmount,
    setFeeAmount,
    nativeUtxos,
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
  } = form

  const handlePostBroadcastClose = () => {
    clearBroadcastState()
    onBroadcastSuccess?.()
  }

  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (buildError || broadcastError || signedTxHex) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [buildError, broadcastError, signedTxHex])

  return (
    <section className="min-w-0 max-w-4xl mt-6">
      <PostBroadcastModal
        open={broadcastTxid != null}
        onClose={handlePostBroadcastClose}
        txid={broadcastTxid}
        successMessage={getBroadcastSuccessMessage('merge_asset')}
        esplora={esplora}
      />
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Merge Asset</h3>
      {!seedHex ? (
        <p className="text-gray-600">Connect seed to build a transaction.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-gray-700">Inputs (same asset, from your UTXOs)</p>
              <button type="button" className="text-blue-600 hover:underline" onClick={addInputRow}>
                + Add input
              </button>
            </div>
            {selectedAssetId != null && (
              <p className="text-gray-600 mb-1 text-xs">
                Merging asset: <span className="font-mono">{shortAssetId(selectedAssetId)}</span> —
                only UTXOs of this asset can be added.
              </p>
            )}
            {inputRows.length === 0 ? (
              <p className="text-gray-500">
                Add at least one input and select a UTXO. Then only UTXOs of that asset will be
                shown.
              </p>
            ) : (
              <ul className="space-y-2">
                {inputRows.map((row) => {
                  const available = getAvailableUtxosForRow(row.id)
                  const value = row.txid && row.vout !== '' ? `${row.txid}:${row.vout}` : ''
                  return (
                    <li key={row.id} className="flex gap-2 items-center flex-wrap">
                      <UtxoSelect
                        className="min-w-[200px] max-w-full font-mono text-sm"
                        adaptiveWidth
                        utxos={available}
                        value={value}
                        onChange={(v) => {
                          if (!v) {
                            clearInputRow(row.id)
                            return
                          }
                          const [txid, voutStr] = v.split(':')
                          const vout = parseInt(voutStr, 10)
                          if (txid && !Number.isNaN(vout)) selectInputUtxo(row.id, txid, vout)
                        }}
                        optionValueType="txid:vout"
                        placeholder="Select UTXO…"
                        labelSuffix="(asset)"
                      />
                      {row.prevout && (
                        <span className="text-gray-600">{row.prevout.value} (asset)</span>
                      )}
                      {row.loadError && (
                        <span className="text-red-600 text-xs">{row.loadError}</span>
                      )}
                      <button
                        type="button"
                        className="text-gray-500 hover:text-red-600 px-1"
                        onClick={() => removeInputRow(row.id)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">Fee UTXO (LBTC)</p>
            {nativeUtxos.length === 0 ? (
              <p className="text-gray-500">No LBTC UTXOs for fee.</p>
            ) : (
              <UtxoSelect
                className="max-w-md"
                utxos={nativeUtxos}
                value={String(feeUtxoIndex)}
                onChange={(v) => setFeeUtxoIndex(parseInt(v, 10))}
                optionValueType="index"
                labelSuffix="sats"
              />
            )}
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">Fee amount (sats)</p>
            <Input
              type="number"
              placeholder="sats"
              min={1}
              className="w-28"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
            />
          </div>

          {inputRows.some((r) => r.prevout != null) && selectedAssetId != null && (
            <div className="p-2 bg-gray-50 rounded border border-gray-200">
              <p className="font-medium text-gray-700 mb-1">Summary</p>
              <p className="text-gray-800 font-mono">
                Total in (asset): {totalInputValue} − outputs {outputsSum} = change {changeAmount}{' '}
                (asset). Fee: {parseInt(feeAmount, 10) || 0} sats (LBTC).
              </p>
              {changeAmount < 0 && (
                <p className="text-red-600 text-xs mt-1">
                  Reduce outputs so change is non-negative.
                </p>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-gray-700">Outputs (in selected asset)</p>
              <button type="button" className="text-blue-600 hover:underline" onClick={addOutput}>
                + Add output
              </button>
            </div>
            {outputs.length === 0 ? (
              <p className="text-gray-500">Add at least one output in the selected asset.</p>
            ) : (
              <ul className="space-y-2">
                {outputs.map((o, idx) => (
                  <li key={o.id} className="flex gap-2 items-center flex-wrap">
                    <Input
                      type="text"
                      placeholder="address"
                      className="flex-1 min-w-[160px] font-mono"
                      value={o.address}
                      onChange={(e) => updateOutput(o.id, 'address', e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="amount"
                      min={1}
                      className="w-24"
                      value={o.amount}
                      onChange={(e) => updateOutput(o.id, 'amount', e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-gray-500 hover:text-red-600 px-1"
                      onClick={() => removeOutput(o.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      disabled={idx === 0}
                      onClick={() => moveOutput(idx, -1)}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      disabled={idx === outputs.length - 1}
                      onClick={() => moveOutput(idx, 1)}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <ButtonSecondary size="md" disabled={!canBuild || building} onClick={handleBuild}>
              {building ? 'Building…' : 'Build'}
            </ButtonSecondary>
            <ButtonSecondary size="md" disabled={!builtMergeTx || building} onClick={handleSign}>
              {building ? 'Signing…' : 'Sign'}
            </ButtonSecondary>
            <ButtonPrimary
              size="md"
              disabled={!builtMergeTx || building}
              onClick={handleBuildAndBroadcast}
            >
              {building ? 'Signing…' : 'Sign & Broadcast'}
            </ButtonPrimary>
            <ButtonNeutral size="md" disabled={building} onClick={handleClear}>
              Clear
            </ButtonNeutral>
          </div>
          {builtMergeTx && !signedTxHex && !broadcastTxid && (
            <p className="text-blue-700 text-sm mt-1">
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
        </div>
      )}
    </section>
  )
}
