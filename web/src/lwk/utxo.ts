import type { AssetId, WalletTxOut } from '@lilbonekit/lwk-web'

import { selectByLargestFirst } from '@/utils/utxo'

// ExternalUtxo max-weight-to-satisfy for an explicit-address UTXO spent with a plain
// p2wpkh/p2tr signature (no Simplicity covenant) — e.g. NFT references like FactoryAuth,
// Borrower NFT, or a pre-acceptance Lender NFT. Measured from several real broadcast txs
// (sig + pubkey = 104-105 bytes), plus margin.
export const EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY = 150

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

export function isConfirmedWalletUtxo(utxo: WalletTxOut): boolean {
  return utxo.height() !== undefined
}

export function requireWalletUtxo(
  walletUtxos: WalletTxOut[],
  outpoint: string,
  label: string,
): WalletTxOut {
  const utxo = findWalletUtxo(walletUtxos, outpoint)
  if (!utxo) throw new Error(`${label} wallet UTXO not found`)
  if (!isConfirmedWalletUtxo(utxo)) throw new Error(`${label} wallet UTXO is not confirmed yet`)
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

export function selectAssetUtxos(
  walletUtxos: WalletTxOut[],
  assetId: AssetId | string,
  amount: bigint,
  label: string,
): WalletTxOut[] {
  const candidates = walletUtxos
    .filter(
      utxo =>
        isConfirmedWalletUtxo(utxo) && utxo.unblinded().asset().toString() === assetId.toString(),
    )
    .map(utxo => ({ value: utxo.unblinded().value(), utxo }))
  const selected = selectByLargestFirst(candidates, amount)
  if (!selected) throw new Error(`Insufficient confirmed ${label} balance`)
  return selected.map(item => item.utxo)
}

export function isPolicyAssetUtxo(utxo: WalletTxOut, policyAsset: AssetId | string): boolean {
  return utxo.unblinded().asset().toString() === policyAsset.toString()
}

// Base overhead (WU) covering the wallet's first confidential input + change output + base tx.
export const WALLET_OVERHEAD_WEIGHT_UNITS = 6000
// Additional wallet P2WPKH input delta measured from Liquid testnet create-offer txs:
// 1650 WU / 6 extra wallet inputs ≈ 275 WU, rounded up for margin.
const FEE_WALLET_INPUT_WEIGHT_UNITS = 400
const FEE_SAFETY_MARGIN_PERCENT = 15n

function weightUnitsToSats(weightUnits: number, feeRateSatPerKvb: number): bigint {
  const vsize = Math.ceil(weightUnits / 4)
  return BigInt(Math.ceil((vsize * feeRateSatPerKvb) / 1000))
}

// Sat ceiling for fee-UTXO selection, scaled by feeRate and expected wallet input count.
export function estimateFeeBudgetSats(
  externalWeightUnits: number,
  feeRateSatPerKvb: number,
  walletInputsCount = 1,
): bigint {
  const extraInputs = Math.max(walletInputsCount - 1, 0)
  const weightUnits =
    externalWeightUnits + WALLET_OVERHEAD_WEIGHT_UNITS + FEE_WALLET_INPUT_WEIGHT_UNITS * extraInputs
  const base = weightUnitsToSats(weightUnits, feeRateSatPerKvb)
  return base + (base * FEE_SAFETY_MARGIN_PERCENT) / 100n
}

export function selectFeeUtxos(
  walletUtxos: WalletTxOut[],
  policyAsset: AssetId | string,
  budgetSats: bigint,
  feeRateSatPerKvb: number,
): WalletTxOut[] {
  const candidates = walletUtxos
    .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAsset))
    .map(utxo => ({ value: utxo.unblinded().value(), utxo }))
  const selected = selectByLargestFirst(candidates, budgetSats, {
    perItemReserve: weightUnitsToSats(FEE_WALLET_INPUT_WEIGHT_UNITS, feeRateSatPerKvb),
  })
  if (!selected) throw new Error('Insufficient confirmed L-BTC balance to cover fees')
  return selected.map(item => item.utxo)
}
