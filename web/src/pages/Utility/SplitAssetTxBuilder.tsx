/**
 * Split-asset tx builder: two UTXOs (fee in LBTC + asset to split),
 * outputs in asset, two change outputs.
 */

import { useSplitAssetTxForm } from '../../tx/split/useSplitAssetTxForm'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { CopyIcon } from '../../components/CopyIcon'

export interface SplitAssetTxBuilderProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string | null
  /** When provided, fee/asset outpoints are controlled from parent (e.g. UTXO table click). */
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

export function SplitAssetTxBuilder({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  outpointFeeTxid: outpointFeeTxidProp,
  outpointFeeVout: outpointFeeVoutProp,
  setOutpointFeeTxid: setOutpointFeeTxidProp,
  setOutpointFeeVout: setOutpointFeeVoutProp,
  outpointAssetTxid: outpointAssetTxidProp,
  outpointAssetVout: outpointAssetVoutProp,
  setOutpointAssetTxid: setOutpointAssetTxidProp,
  setOutpointAssetVout: setOutpointAssetVoutProp,
  onBroadcastSuccess,
}: SplitAssetTxBuilderProps) {
  const form = useSplitAssetTxForm({
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
  })

  const {
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
    broadcastTxid,
    broadcastError,
    handleBuild,
    handleBuildAndBroadcast,
    handleClear,
    feeValue,
    assetValue,
    outputsSum,
    changeLbtc,
    changeAsset,
    canBuild,
  } = form

  return (
    <section className="min-w-0 max-w-4xl mt-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Split asset</h3>
      {!seedHex ? (
        <p className="text-gray-600">Connect seed to build a transaction.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-gray-700 mb-1">Fee UTXO (LBTC)</p>
            <div className="flex gap-2 flex-wrap items-center">
              <input
                type="text"
                placeholder="txid"
                className="flex-1 min-w-[200px] border border-gray-300 rounded px-2 py-1.5 font-mono text-gray-900"
                value={outpointFeeTxid}
                onChange={(e) => setOutpointFeeTxid(e.target.value)}
              />
              <input
                type="number"
                placeholder="vout"
                min={0}
                className="w-20 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                value={outpointFeeVout}
                onChange={(e) => setOutpointFeeVout(e.target.value)}
              />
              <button
                type="button"
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded"
                onClick={loadPrevoutFee}
              >
                Load
              </button>
            </div>
            {loadErrorFee && <p className="text-red-600 mt-1">{loadErrorFee}</p>}
            {loadedPrevoutFee && (
              <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200">
                <p className="font-medium text-gray-700">
                  Fee UTXO: {loadedPrevoutFee.value} sats (LBTC)
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">Asset UTXO (to split)</p>
            <div className="flex gap-2 flex-wrap items-center">
              <input
                type="text"
                placeholder="txid"
                className="flex-1 min-w-[200px] border border-gray-300 rounded px-2 py-1.5 font-mono text-gray-900"
                value={outpointAssetTxid}
                onChange={(e) => setOutpointAssetTxid(e.target.value)}
              />
              <input
                type="number"
                placeholder="vout"
                min={0}
                className="w-20 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                value={outpointAssetVout}
                onChange={(e) => setOutpointAssetVout(e.target.value)}
              />
              <button
                type="button"
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded"
                onClick={loadPrevoutAsset}
              >
                Load
              </button>
            </div>
            {utxos.length > 0 && (
              <p className="text-gray-500 mt-1">Pick an ASSET row from the UTXO table above.</p>
            )}
            {loadErrorAsset && <p className="text-red-600 mt-1">{loadErrorAsset}</p>}
            {loadedPrevoutAsset && (
              <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200">
                <p className="font-medium text-gray-700">
                  Asset UTXO: {loadedPrevoutAsset.value} (asset)
                </p>
                {loadedPrevoutAsset.asset && (
                  <p className="text-gray-600 font-mono text-xs">{loadedPrevoutAsset.asset}</p>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">Fee (LBTC)</p>
            <input
              type="number"
              placeholder="sats"
              min={0}
              className="w-28 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
            />
          </div>

          {(loadedPrevoutFee || loadedPrevoutAsset) && (
            <div className="p-2 bg-gray-50 rounded border border-gray-200 space-y-1">
              <p className="font-medium text-gray-700 mb-1">Change (to your account)</p>
              <p className="text-gray-800 font-mono">
                Change (LBTC):{' '}
                {changeLbtc < 0 ? (
                  <span className="text-red-600">{changeLbtc}</span>
                ) : (
                  `${changeLbtc} sats`
                )}
              </p>
              <p className="text-gray-800 font-mono">
                Change (asset):{' '}
                {changeAsset < 0 ? (
                  <span className="text-red-600">{changeAsset}</span>
                ) : (
                  `${changeAsset}`
                )}
              </p>
              {(changeLbtc < 0 || changeAsset < 0) && (
                <p className="text-red-600 text-xs mt-1">
                  Reduce outputs or fee so both changes are non-negative.
                </p>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-gray-700">Outputs (in asset)</p>
              <button type="button" className="text-blue-600 hover:underline" onClick={addOutput}>
                + Add output
              </button>
            </div>
            {outputs.length === 0 ? (
              <p className="text-gray-500">Add recipient outputs in the selected asset.</p>
            ) : (
              <ul className="space-y-2">
                {outputs.map((o, idx) => (
                  <li key={o.id} className="flex gap-2 items-center flex-wrap">
                    <input
                      type="text"
                      placeholder="address"
                      className="flex-1 min-w-[160px] border border-gray-300 rounded px-2 py-1.5 font-mono text-gray-900"
                      value={o.address}
                      onChange={(e) => updateOutput(o.id, 'address', e.target.value)}
                    />
                    <input
                      type="number"
                      placeholder="amount"
                      min={1}
                      className="w-24 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
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
            {loadedPrevoutAsset && (
              <p className="mt-2 text-gray-600">
                Asset {assetValue} − outputs {outputsSum} = change {changeAsset}; Fee UTXO{' '}
                {feeValue} − fee = change {changeLbtc} LBTC
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50 disabled:pointer-events-none"
              disabled={!canBuild || building}
              onClick={handleBuild}
            >
              {building ? 'Building…' : 'Build & Sign'}
            </button>
            <button
              type="button"
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded disabled:opacity-50 disabled:pointer-events-none"
              disabled={!canBuild || building}
              onClick={handleBuildAndBroadcast}
            >
              {building ? 'Building…' : 'Build & Broadcast'}
            </button>
            <button
              type="button"
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded disabled:opacity-50 disabled:pointer-events-none"
              disabled={building}
              onClick={handleClear}
            >
              Clear
            </button>
          </div>
          {buildError && <p className="text-red-600 mt-2">{buildError}</p>}
          {broadcastError && <p className="text-red-600 mt-2">{broadcastError}</p>}
          {broadcastTxid && (
            <p className="mt-2 text-green-700 flex items-center gap-1.5 flex-wrap">
              <span>Broadcast successful. Txid:</span>
              <a
                href={esplora.getTxExplorerUrl(broadcastTxid)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-green-800 hover:underline underline-offset-1"
              >
                {broadcastTxid}
              </a>
              <button
                type="button"
                className="p-1 rounded text-green-700 hover:bg-green-100"
                onClick={() => navigator.clipboard?.writeText(broadcastTxid)}
                title="Copy txid"
                aria-label="Copy txid"
              >
                <CopyIcon className="h-4 w-4" />
              </button>
            </p>
          )}
          {signedTxHex && (
            <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
              <p className="font-medium text-gray-700 mb-1">Signed transaction (hex)</p>
              <textarea
                readOnly
                className="w-full font-mono text-xs text-gray-900 bg-white border border-gray-200 rounded p-2 h-24"
                value={signedTxHex}
              />
              <button
                type="button"
                className="mt-2 text-blue-600 hover:underline text-sm"
                onClick={() => navigator.clipboard?.writeText(signedTxHex)}
              >
                Copy hex
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
