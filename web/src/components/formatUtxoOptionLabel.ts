/**
 * Format a single UTXO as option label: "start...end:vout — value suffix".
 * Txid is shortened to startLen + "..." + endLen (e.g. 1234a...b5678).
 */

import type { ScripthashUtxoEntry } from '../api/esplora'

const START_LEN = 5
const END_LEN = 5

export interface FormatUtxoOptionLabelOptions {
  startLen?: number
  endLen?: number
  /** e.g. "sats" or "(asset)" appended after value. */
  suffix?: string
}

export function formatUtxoOptionLabel(
  utxo: ScripthashUtxoEntry,
  options?: FormatUtxoOptionLabelOptions
): string {
  const startLen = options?.startLen ?? START_LEN
  const endLen = options?.endLen ?? END_LEN
  const suffix = options?.suffix ?? 'sats'
  const txid = (utxo.txid ?? '').trim()
  const start = txid.slice(0, startLen)
  const end = txid.length > startLen + endLen ? txid.slice(-endLen) : txid.slice(startLen)
  const mid = txid.length > startLen + endLen ? '…' : ''
  const txidShort = end ? `${start}${mid}${end}` : start || '—'
  const valuePart = utxo.value != null ? ` — ${utxo.value} ${suffix}` : ` — ? ${suffix}`
  return `${txidShort}:${utxo.vout}${valuePart}`
}
