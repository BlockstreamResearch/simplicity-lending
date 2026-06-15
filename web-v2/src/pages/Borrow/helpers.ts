import type { WalletUtxo } from '@/hooks/usePolicyAssetUtxos'

export const MAX_LTV = 0.55

export const TERM_OPTIONS = [
  { id: 7, label: '7 days' },
  { id: 14, label: '14 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
]

export function selectSmallestUtxo(utxos: WalletUtxo[], amount: bigint): WalletUtxo | null {
  return (
    utxos
      .filter(utxo => utxo.value >= amount)
      .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))[0] ?? null
  )
}
