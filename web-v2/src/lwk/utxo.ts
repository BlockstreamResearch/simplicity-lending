import type { AssetId, WalletTxOut } from 'lwk_web'

export function outpointToString(utxo: WalletTxOut): string {
  const outpoint = utxo.outpoint()
  return `${outpoint.txid().toString()}:${outpoint.vout()}`
}

export function isPolicyAssetUtxo(utxo: WalletTxOut, policyAsset: AssetId | string): boolean {
  return utxo.unblinded().asset().toString() === policyAsset.toString()
}

export function getPolicyAssetUtxos(
  walletUtxos: WalletTxOut[],
  policyAsset: AssetId | string,
): WalletTxOut[] {
  return walletUtxos.filter(utxo => isPolicyAssetUtxo(utxo, policyAsset))
}

export function findUtxoByOutpoint(
  walletUtxos: WalletTxOut[],
  outpoint: string,
): WalletTxOut | null {
  return walletUtxos.find(utxo => outpointToString(utxo) === outpoint) ?? null
}
