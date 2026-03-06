/**
 * Types for split-transaction form and build params.
 */

/** Single row in the outputs list (UI). */
export interface TxOutputRow {
  id: number
  address: string
  amount: string
}

/** Outpoint (txid + vout index). */
export interface Outpoint {
  txid: string
  vout: number
}
