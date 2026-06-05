import type { AssetId, WalletTxOut } from 'lwk_web'

export function utxoToOutpointString(utxo: WalletTxOut): string {
  const outpoint = utxo.outpoint()
  return `${outpoint.txid().toString()}:${outpoint.vout()}`
}

export function isPolicyAssetUtxo(utxo: WalletTxOut, policyAsset: AssetId | string): boolean {
  return utxo.unblinded().asset().toString() === policyAsset.toString()
}
