import type { EsploraClient, Network, Wollet } from 'lwk_web'

import { env } from '@/constants/env'
import type { Lwk } from '@/lwk'

/**
 * Creates an EsploraClient configured for waterfalls + utxoOnly scanning.
 * Waterfalls provides fast indexed encrypted UTXO discovery vs slow sequential HD scan.
 */
export function createEsploraClient(lwk: Lwk, lwkNetwork: Network): EsploraClient {
  const client = new lwk.EsploraClient(
    lwkNetwork,
    env.VITE_WATERFALLS_URL,
    true, // waterfalls
    4, // concurrency
    true, // utxoOnly
  )
  if (lwkNetwork.isMainnet() || lwkNetwork.isTestnet()) {
    client.setWaterfallsServerRecipient(env.VITE_WATERFALLS_RECIPIENT)
  }
  return client
}

/**
 * Syncs wallet state via waterfalls fullScan and applies the update.
 * Returns the updated balance map (assetId -> satoshis).
 */
export async function syncWallet(
  wollet: Wollet,
  esploraClient: EsploraClient,
): Promise<[string, bigint][]> {
  const update = await esploraClient.fullScanToIndex(wollet, 0)
  if (update) {
    wollet.applyUpdate(update)
  }
  return wollet.balance().entries() as [string, bigint][]
}
