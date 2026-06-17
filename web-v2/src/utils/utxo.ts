import type { PolicyAssetUtxo } from '@/hooks/usePolicyAssetUtxos'

export function selectOptimalUtxo(
  utxos: PolicyAssetUtxo[],
  amount: bigint,
): PolicyAssetUtxo | null {
  return (
    utxos
      .filter(utxo => utxo.value >= amount)
      .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))[0] ?? null
  )
}
