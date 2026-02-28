/**
 * Stable key for a UTXO (txid + vout). Used by merge/burn form hooks for React keys and maps.
 */
export function utxoKey(txid: string, vout: number): string {
  return `${txid}:${vout}`
}
