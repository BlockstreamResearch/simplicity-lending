import type { Network, SimplicityArguments, Transaction, XOnlyPublicKey } from 'lwk_web'

import type { NetworkName } from '@/constants/env'

export type Lwk = typeof import('lwk_web')

let lwk: Lwk | null = null

export async function getLwk(): Promise<Lwk> {
  if (!lwk) {
    lwk = await import('lwk_web')
    if (typeof lwk.default === 'function') await lwk.default()
  }
  return lwk
}

export function createLwkNetwork(network: NetworkName, lwk: Lwk): Network {
  switch (network) {
    case 'liquid':
      return lwk.Network.mainnet()
    case 'liquidtestnet':
      return lwk.Network.testnet()
    case 'regtest':
      return lwk.Network.regtestDefault()
  }
}

export interface PsetWithExtractTx {
  extractTx(): Transaction
}

export interface CreateP2trAddressParams {
  source: string
  args: SimplicityArguments
  internalKey: XOnlyPublicKey
  network: NetworkName
}

export function createP2trAddress(lwk: Lwk, params: CreateP2trAddressParams): string {
  const program = lwk.SimplicityProgram.load(params.source, params.args)
  const net = createLwkNetwork(params.network, lwk)
  const address = program.createP2trAddress(params.internalKey, net)
  return address.toString()
}
