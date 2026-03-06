/**
 * Pure validation/calculation helpers for split transaction.
 */

import type { TxOutputRow } from './types'

/**
 * Change = inputValue − fee − sum(output amounts).
 */
export function computeChange(inputValue: number, feeSats: number, outputsSum: number): number {
  return inputValue - feeSats - outputsSum
}

/**
 * True if we have a loaded prevout, valid fee, non-negative change,
 * and every output has an address and positive amount.
 */
export function canBuildSplit(
  loadedPrevout: { value?: number } | null,
  feeNum: number,
  changeAmount: number,
  outputs: TxOutputRow[],
  accountAddress: string | null
): boolean {
  if (loadedPrevout == null || accountAddress == null) return false
  if (feeNum < 0 || changeAmount < 0) return false
  const validAmounts =
    loadedPrevout.value != null &&
    feeNum >= 0 &&
    changeAmount >= 0 &&
    outputs.every((o) => (parseInt(o.amount, 10) || 0) >= 0)
  if (!validAmounts) return false
  return outputs.every((o) => o.address.trim() !== '' && (parseInt(o.amount, 10) || 0) > 0)
}
