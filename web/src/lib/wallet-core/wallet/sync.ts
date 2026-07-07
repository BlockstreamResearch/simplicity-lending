import type { EsploraClient, Wollet } from '@lilbonekit/lwk-web'

import { isConfirmedWalletUtxo } from '@/lwk/utxo'

export interface WalletBalances {
  total: Record<string, string>
  confirmed: Record<string, string>
}

/**
 * Syncs wallet state via waterfalls fullScan and applies the update.
 * Returns the updated total and confirmed-only balance maps.
 */
export async function syncBalances(
  wollet: Wollet,
  esploraClient: EsploraClient,
): Promise<WalletBalances> {
  const update = await esploraClient.fullScanToIndex(wollet, 0)
  if (update) {
    wollet.applyUpdate(update)
  }

  const total: Record<string, string> = {}
  for (const [assetId, amount] of wollet.balance().entries() as [string, bigint][]) {
    total[assetId] = amount.toString()
  }

  const confirmedAmounts = new Map<string, bigint>()
  for (const utxo of wollet.utxos()) {
    if (!isConfirmedWalletUtxo(utxo)) continue
    const unblinded = utxo.unblinded()
    const assetId = unblinded.asset().toString()
    confirmedAmounts.set(assetId, (confirmedAmounts.get(assetId) ?? 0n) + unblinded.value())
  }
  const confirmed: Record<string, string> = {}
  for (const [assetId, amount] of confirmedAmounts) {
    confirmed[assetId] = amount.toString()
  }

  return { total, confirmed }
}
