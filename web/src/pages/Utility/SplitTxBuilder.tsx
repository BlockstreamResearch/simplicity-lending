/**
 * Split transaction builder UI: outpoint, Load, prevout, fee, change, outputs list, Build & Sign.
 */

import { useSplitTxForm } from '../../tx/split/useSplitTxForm'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { CopyIcon } from '../../components/CopyIcon'
import {
  ButtonPrimary,
  ButtonSecondary,
  ButtonNeutral,
  ButtonIconNeutral,
} from '../../components/Button'

export interface SplitTxBuilderProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string | null
  outpointTxid: string
  outpointVout: string
  setOutpointTxid: (s: string) => void
  setOutpointVout: (s: string) => void
  /** Called after a successful broadcast (e.g. to refresh UTXOs). */
  onBroadcastSuccess?: () => void
}

export function SplitTxBuilder({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  outpointTxid,
  outpointVout,
  setOutpointTxid,
  setOutpointVout,
  onBroadcastSuccess,
}: SplitTxBuilderProps) {
  const splitForm = useSplitTxForm({
    esplora,
    accountAddress,
    seedHex,
    accountIndex,
    outpointTxid,
    outpointVout,
    setOutpointTxid,
    setOutpointVout,
    onBroadcastSuccess,
  })

  const {
    loadedPrevout,
    loadError,
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
    loadPrevout,
    handleBuild,
    handleBuildAndBroadcast,
    handleClear,
    inputValue,
    feeNum,
    outputsSum,
    changeAmount,
    canBuild,
  } = splitForm

  return (
    <section className="min-w-0 max-w-4xl mt-10">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Split LBTC</h3>
      {!seedHex ? (
        <p className="text-gray-600">Connect seed to build a transaction.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-gray-700 mb-1">Input (OutPoint)</p>
            <div className="flex gap-2 flex-wrap items-center">
              <input
                type="text"
                placeholder="txid"
                className="flex-1 min-w-[200px] border border-gray-300 rounded px-2 py-1.5 font-mono text-gray-900"
                value={outpointTxid}
                onChange={(e) => setOutpointTxid(e.target.value)}
              />
              <input
                type="number"
                placeholder="vout"
                min={0}
                className="w-20 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                value={outpointVout}
                onChange={(e) => setOutpointVout(e.target.value)}
              />
              <button
                type="button"
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded"
                onClick={loadPrevout}
              >
                Load
              </button>
            </div>
            {utxos.length > 0 && (
              <p className="text-gray-500 mt-1">Or click a UTXO above to fill txid/vout.</p>
            )}
            {loadError && <p className="text-red-600 mt-1">{loadError}</p>}
            {loadedPrevout && (
              <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200">
                <p className="font-medium text-gray-700">
                  Input: amount {loadedPrevout.value} sats
                </p>
                {loadedPrevout.asset && (
                  <p className="text-gray-600 font-mono text-xs">asset: {loadedPrevout.asset}</p>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="font-medium text-gray-700 mb-1">Fee (empty script, last output)</p>
            <input
              type="number"
              placeholder="sats"
              min={0}
              className="w-28 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
            />
          </div>

          {loadedPrevout && (
            <div className="p-2 bg-gray-50 rounded border border-gray-200">
              <p className="font-medium text-gray-700 mb-1">Change (to your account)</p>
              <p className="text-gray-800 font-mono">
                {changeAmount < 0 ? (
                  <span className="text-red-600">
                    Exceeds available ({inputValue} − {feeNum} − {outputsSum} = {changeAmount})
                  </span>
                ) : (
                  <>{changeAmount} sats → current account</>
                )}
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-gray-700">Outputs</p>
              <button type="button" className="text-blue-600 hover:underline" onClick={addOutput}>
                + Add output
              </button>
            </div>
            {outputs.length === 0 ? (
              <p className="text-gray-500">
                Optional: add recipient outputs. Change goes to your account.
              </p>
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
                      placeholder="sats"
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
            {loadedPrevout && (
              <p className="mt-2 text-gray-600">
                Input {inputValue} − fee {feeNum} − outputs {outputsSum} = change {changeAmount}
                {changeAmount < 0 && (
                  <span className="text-red-600 ml-1">
                    {' '}
                    — reduce outputs or fee to enable Build & Sign
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <ButtonSecondary size="md" disabled={!canBuild || building} onClick={handleBuild}>
              {building ? 'Building…' : 'Build & Sign'}
            </ButtonSecondary>
            <ButtonPrimary
              size="md"
              disabled={!canBuild || building}
              onClick={handleBuildAndBroadcast}
            >
              {building ? 'Building…' : 'Build & Broadcast'}
            </ButtonPrimary>
            <ButtonNeutral size="md" disabled={building} onClick={handleClear}>
              Clear
            </ButtonNeutral>
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
              <ButtonIconNeutral
                onClick={() => navigator.clipboard?.writeText(broadcastTxid)}
                title="Copy txid"
                aria-label="Copy txid"
              >
                <CopyIcon className="h-4 w-4" />
              </ButtonIconNeutral>
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
              <ButtonNeutral
                size="sm"
                className="mt-2"
                onClick={() => navigator.clipboard?.writeText(signedTxHex)}
              >
                Copy hex
              </ButtonNeutral>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
