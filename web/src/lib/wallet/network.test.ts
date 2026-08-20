import { describe, expect, it } from 'vitest'

import { LIQUID_TESTNET_CHAIN_ID } from '@/lib/humid/appkit-injected-adapter'
import {
  WALLET_CHAIN,
  WALLET_CHAIN_ID,
  WALLET_CHAIN_UNSUPPORTED_REASON,
  WALLET_CHAINS,
  WALLET_NAMESPACE,
} from '@/lib/wallet/network'

describe('the chain the wallet connection speaks for', () => {
  it('registers exactly one chain, so a call that names none cannot land on another', () => {
    expect(WALLET_CHAINS).toHaveLength(1)
  })

  it('is the chain the build is configured for, not the first of a list', () => {
    expect(WALLET_CHAIN).not.toBeNull()
    expect(WALLET_CHAIN_UNSUPPORTED_REASON).toBeNull()
    expect(WALLET_CHAIN_ID).toBe(LIQUID_TESTNET_CHAIN_ID)
    expect(WALLET_CHAINS[0].caipNetworkId).toBe(LIQUID_TESTNET_CHAIN_ID)
  })

  it('scopes accounts to the namespace Liquid shares with Bitcoin', () => {
    expect(WALLET_NAMESPACE).toBe('bip122')
  })
})
