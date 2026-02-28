/**
 * Burn tx builder: select ASSET UTXOs (no LBTC), each is burned (OP_RETURN); one fee UTXO.
 */

import { useMemo } from 'react'
import { useBurnTxForm } from '../../tx/burn/useBurnTxForm'
import type { EsploraClient, ScripthashUtxoEntry } from '../../api/esplora'
import { PostBroadcastModal } from '../../components/PostBroadcastModal'
import { getBroadcastSuccessMessage } from '../../components/broadcastSuccessMessages'
import {
  ButtonPrimary,
  ButtonSecondary,
  ButtonNeutral,
} from '../../components/Button'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'
import { formatUtxoOptionLabel } from '../../components/formatUtxoOptionLabel'

function utxoKey(txid: string, vout: number): string {
  return `${txid}:${vout}`
}

function rowToUtxoEntry(row: {
  txid: string
  vout: number
  prevout: { value?: number } | null
}): ScripthashUtxoEntry {
  return {
    txid: row.txid,
    vout: row.vout,
    value: row.prevout?.value,
    status: { confirmed: true },
  }
}

export interface BurnTxBuilderProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string | null
  onBroadcastSuccess?: () => void
}

export function BurnTxBuilder({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  onBroadcastSuccess,
}: BurnTxBuilderProps) {
  const form = useBurnTxForm({
    esplora,
    accountAddress,
    seedHex,
    accountIndex,
    utxos,
  })

  const {
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
  } = form

  const selectedKeys = useMemo(
    () => new Set(selectedRows.map((r) => utxoKey(r.txid, r.vout))),
    [selectedRows]
  )
  const availableToAdd = useMemo(
    () => assetUtxos.filter((u) => !selectedKeys.has(utxoKey(u.txid, u.vout))),
    [assetUtxos, selectedKeys]
  )

  const handleAddUtxo = (value: string) => {
    if (!value) return
    const [txid, voutStr] = value.split(':')
    const vout = parseInt(voutStr, 10)
    if (txid && !Number.isNaN(vout)) addSelectedUtxo(txid, vout)
  }

  const handlePostBroadcastClose = () => {
    clearBroadcastState()
    onBroadcastSuccess?.()
  }

  return (
    <section className="min-w-0 max-w-4xl mt-6">
      <PostBroadcastModal
        open={broadcastTxid != null}
        onClose={handlePostBroadcastClose}
        txid={broadcastTxid}
        successMessage={getBroadcastSuccessMessage('burn')}
        esplora={esplora}
      />
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Burn</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            Select ASSET UTXOs to burn (LBTC cannot be burned). Each selected UTXO becomes one burn
            output.
          </p>
        </div>
        <div className="p-5 space-y-5 text-sm">
          {!seedHex ? (
            <p className="text-gray-600">Connect seed to build a transaction.</p>
          ) : (
            <>
              <div>
                <p className={formClassNames.label}>UTXOs to burn (ASSET only)</p>
                {availableToAdd.length === 0 && selectedRows.length === 0 && (
                  <p className="text-gray-500">
                    No asset UTXOs available. Only non-LBTC UTXOs can be burned.
                  </p>
                )}
                {availableToAdd.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <UtxoSelect
                      className="min-w-[200px] max-w-full font-mono"
                      adaptiveWidth
                      utxos={availableToAdd}
                      value=""
                      onChange={handleAddUtxo}
                      optionValueType="txid:vout"
                      placeholder="Select UTXO to burn…"
                      labelSuffix="(asset)"
                    />
                  </div>
                )}
                {selectedRows.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {selectedRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-2 py-2 px-3 rounded-xl border border-gray-200 bg-gray-50/80"
                      >
                        <span className="font-mono text-gray-800 truncate min-w-0">
                          {formatUtxoOptionLabel(rowToUtxoEntry(row), { suffix: '(asset)' })}
                        </span>
                        {row.loadError && (
                          <span className="text-red-600 text-xs shrink-0">{row.loadError}</span>
                        )}
                        <button
                          type="button"
                          className="shrink-0 text-gray-500 hover:text-red-600 px-1"
                          onClick={() => removeSelected(row.id)}
                          title="Remove"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className={formClassNames.label}>Fee UTXO (LBTC)</p>
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
                <p className={formClassNames.label}>Fee amount (sats)</p>
                <Input
                  type="number"
                  min={1}
                  className="w-28"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <ButtonSecondary size="md" disabled={!canBuild || building} onClick={handleBuild}>
                  {building ? 'Building…' : 'Build'}
                </ButtonSecondary>
                <ButtonSecondary
                  size="md"
                  disabled={!builtBurnTx || building}
                  onClick={handleSign}
                >
                  {building ? 'Signing…' : 'Sign'}
                </ButtonSecondary>
                <ButtonPrimary
                  size="md"
                  disabled={!builtBurnTx || building}
                  onClick={handleBuildAndBroadcast}
                >
                  {building ? 'Signing…' : 'Sign & Broadcast'}
                </ButtonPrimary>
                <ButtonNeutral size="md" disabled={building} onClick={handleClear}>
                  Clear
                </ButtonNeutral>
              </div>

              {builtBurnTx && !signedTxHex && !broadcastTxid && (
                <p className="text-blue-700 text-sm">Transaction built. Click Sign or Sign & Broadcast.</p>
              )}

              {buildError && <p className="text-red-600">{buildError}</p>}
              {broadcastError && <p className="text-red-600">{broadcastError}</p>}
              {signedTxHex && !broadcastTxid && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="font-medium text-gray-700 mb-1">Signed transaction (hex)</p>
                  <textarea
                    readOnly
                    className="w-full font-mono text-xs text-gray-900 bg-white border border-gray-200 rounded-xl p-2 h-24"
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
            </>
          )}
        </div>
      </div>
    </section>
  )
}
