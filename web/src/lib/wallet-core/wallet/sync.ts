import type { EsploraClient, Wollet } from '@lilbonekit/lwk-web'

/**
 * Syncs wallet state via waterfalls fullScan and applies the update.
 * Returns the updated balance map (assetId -> satoshis as strings).
 */
export async function syncBalances(
  wollet: Wollet,
  esploraClient: EsploraClient,
): Promise<Record<string, string>> {
  const update = await esploraClient.fullScanToIndex(wollet, 0)
  if (update) {
    wollet.applyUpdate(update)
  }
  const result: Record<string, string> = {}
  for (const [assetId, amount] of wollet.balance().entries() as [string, bigint][]) {
    result[assetId] = amount.toString()
  }
  return result
}
