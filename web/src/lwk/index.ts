import { EsploraClient, Network, type Transaction } from '@lilbonekit/lwk-web'

import { env, type NetworkName } from '@/constants/env'

export type Lwk = typeof import('@lilbonekit/lwk-web')

let lwk: Lwk | null = null

export async function getLwk(): Promise<Lwk> {
  if (!lwk) {
    lwk = await import('@lilbonekit/lwk-web')
    if (typeof lwk.default === 'function') await lwk.default()
  }
  return lwk
}

export function createLwkNetwork(network: NetworkName): Network {
  switch (network) {
    case 'liquid':
      return Network.mainnet()
    case 'liquidtestnet':
      return Network.testnet()
    case 'regtest':
      return Network.regtestDefault()
  }
}

export interface PsetWithExtractTx {
  extractTx(): Transaction
}

/**
 * Creates an EsploraClient configured for waterfalls + utxoOnly scanning.
 * Waterfalls provides fast indexed encrypted UTXO discovery vs slow sequential HD scan.
 */
export function createEsploraClient(lwkNetwork: Network): EsploraClient {
  const client = new EsploraClient(
    lwkNetwork,
    `${env.VITE_WATERFALLS_URL}/api`,
    true, // waterfalls
    4, // concurrency
    true, // utxoOnly
  )
  if (lwkNetwork.isMainnet() || lwkNetwork.isTestnet()) {
    client.setWaterfallsServerRecipient(env.VITE_WATERFALLS_RECIPIENT)
  }
  return client
}
