/**
 * UTXO dropdown with unified label format: start...end:vout (e.g. 1234a...b5678:0).
 * Uses Select styling; supports value by index or by txid:vout.
 */

import type { ScripthashUtxoEntry } from '../api/esplora'
import { formatUtxoOptionLabel } from './formatUtxoOptionLabel'
import { Select } from './Select'

export type UtxoSelectValueType = 'index' | 'txid:vout'

export interface UtxoSelectProps {
  utxos: ScripthashUtxoEntry[]
  value: string
  onChange: (value: string) => void
  /** How option value is stored: index in utxos array, or "txid:vout". */
  optionValueType: UtxoSelectValueType
  /** Placeholder / empty option label (e.g. "Select UTXO…"). */
  placeholder?: string
  /** Label suffix after value, e.g. "sats" or "(asset)". */
  labelSuffix?: string
  className?: string
  id?: string
  disabled?: boolean
  /** When true, width follows content (for long UTXO labels). */
  adaptiveWidth?: boolean
}

export function UtxoSelect({
  utxos,
  value,
  onChange,
  optionValueType,
  placeholder,
  labelSuffix = 'sats',
  className,
  id,
  disabled,
  adaptiveWidth,
}: UtxoSelectProps) {
  const sorted =
    optionValueType === 'index'
      ? utxos
          .map((u, idx) => ({ u, idx }))
          .sort((a, b) => {
            const c = a.u.txid.localeCompare(b.u.txid)
            return c !== 0 ? c : a.u.vout - b.u.vout
          })
      : [...utxos].sort((a, b) => {
          const c = a.txid.localeCompare(b.txid)
          return c !== 0 ? c : a.vout - b.vout
        })

  const options =
    optionValueType === 'index'
      ? (sorted as { u: ScripthashUtxoEntry; idx: number }[]).map(({ u, idx }) => ({
          value: String(idx),
          label: formatUtxoOptionLabel(u, { suffix: labelSuffix }),
        }))
      : (sorted as ScripthashUtxoEntry[]).map((u) => ({
          value: `${u.txid}:${u.vout}`,
          label: formatUtxoOptionLabel(u, { suffix: labelSuffix }),
        }))

  const selectOptions = placeholder ? [{ value: '', label: placeholder }, ...options] : options

  return (
    <Select
      id={id}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={selectOptions}
      disabled={disabled}
      adaptiveWidth={adaptiveWidth}
    />
  )
}
