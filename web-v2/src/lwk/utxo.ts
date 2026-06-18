import type { AssetId, WalletTxOut } from 'lwk_web'

export function utxoToOutpointString(utxo: WalletTxOut): string {
  const outpoint = utxo.outpoint()
  return `${outpoint.txid().toString()}:${outpoint.vout()}`
}

export function findWalletUtxo(
  walletUtxos: WalletTxOut[],
  outpoint: string,
): WalletTxOut | undefined {
  const normalizedOutpoint = outpoint.trim()
  return walletUtxos.find(utxo => utxoToOutpointString(utxo) === normalizedOutpoint)
}

export function requireWalletUtxo(
  walletUtxos: WalletTxOut[],
  outpoint: string,
  label: string,
): WalletTxOut {
  const utxo = findWalletUtxo(walletUtxos, outpoint)
  if (!utxo) throw new Error(`${label} wallet UTXO not found`)
  return utxo
}

export function assertWalletUtxoAssetAndMinimumAmount(
  utxo: WalletTxOut,
  assetId: AssetId | string,
  minimumAmount: bigint,
  label: string,
): void {
  const unblinded = utxo.unblinded()
  const actualAssetId = unblinded.asset().toString()
  if (actualAssetId !== assetId.toString()) {
    throw new Error(`${label} UTXO has unexpected asset ${actualAssetId}`)
  }
  if (unblinded.value() < minimumAmount) {
    throw new Error(`${label} UTXO amount is lower than ${minimumAmount.toString()}`)
  }
}

export function isPolicyAssetUtxo(utxo: WalletTxOut, policyAsset: AssetId | string): boolean {
  return utxo.unblinded().asset().toString() === policyAsset.toString()
}

export function selectFeeUtxo(
  walletUtxos: WalletTxOut[],
  policyAsset: AssetId | string,
): WalletTxOut {
  const feeUtxo = walletUtxos.find(utxo => isPolicyAssetUtxo(utxo, policyAsset))
  if (!feeUtxo) throw new Error('No policy asset UTXO available for fees')
  return feeUtxo
}
