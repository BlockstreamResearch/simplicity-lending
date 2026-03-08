import { describe, expect, it } from 'vitest'
import type { SessionTypes } from '@walletconnect/types'
import {
  createWalletAbiCaipNetwork,
  resolveWalletAbiNetwork,
  selectWalletAbiSessions,
} from './walletConnectSession'
import { inferWalletAbiNetworkFromAddress } from '../utility/addressP2pk'

function sessionWith({
  topic,
  expiry,
  chainId,
}: {
  topic: string
  expiry: number
  chainId: string
}): SessionTypes.Struct {
  return {
    topic,
    pairingTopic: `${topic}-pairing`,
    relay: {
      protocol: 'irn',
    },
    expiry,
    acknowledged: true,
    controller: 'controller',
    namespaces: {
      walabi: {
        accounts: [`${chainId}:02deadbeef`],
        methods: [
          'get_signer_receive_address',
          'get_raw_signing_x_only_pubkey',
          'wallet_abi_process_request',
        ],
        events: [],
      },
    },
    requiredNamespaces: {
      walabi: {
        chains: [chainId],
        methods: [
          'get_signer_receive_address',
          'get_raw_signing_x_only_pubkey',
          'wallet_abi_process_request',
        ],
        events: [],
      },
    },
    optionalNamespaces: {},
    self: {
      publicKey: 'self',
      metadata: {
        name: 'self',
        description: 'self',
        url: 'https://example.com',
        icons: [],
      },
    },
    peer: {
      publicKey: 'peer',
      metadata: {
        name: 'peer',
        description: 'peer',
        url: 'https://example.com',
        icons: [],
      },
    },
  }
}

describe('walletConnectSession', () => {
  it('keeps the newest wallet_abi session and marks older ones as stale', () => {
    const chainId = 'walabi:testnet-liquid'
    const selected = selectWalletAbiSessions(
      [
        sessionWith({
          topic: 'older',
          expiry: 10,
          chainId,
        }),
        sessionWith({
          topic: 'newer',
          expiry: 20,
          chainId,
        }),
      ],
      chainId
    )

    expect(selected.activeSession?.topic).toBe('newer')
    expect(selected.staleSessions.map((session) => session.topic)).toEqual(['older'])
  })

  it('builds a custom WalletConnect network for the selected wallet abi chain', () => {
    const network = createWalletAbiCaipNetwork('localtest-liquid')

    expect(network.chainNamespace).toBe('walabi')
    expect(network.caipNetworkId).toBe('walabi:localtest-liquid')
    expect(network.rpcUrls.default.http).toEqual(['http://127.0.0.1:3001'])
  })

  it('defaults invalid or missing network config to testnet-liquid', () => {
    expect(resolveWalletAbiNetwork(undefined)).toBe('testnet-liquid')
    expect(resolveWalletAbiNetwork('unsupported-network')).toBe('testnet-liquid')
  })

  it('infers wallet abi networks from Liquid address prefixes', () => {
    expect(
      inferWalletAbiNetworkFromAddress(
        'tlq1qq2xvpcvfup5j8zscjq05u2wxxjcyewk7979f3mmz5l7uw5pqmx6xf5xy50hsn6vhkm5euwt72x878eq6zxx2z58hd7zrsg9qn'
      )
    ).toBe('testnet-liquid')
    expect(
      inferWalletAbiNetworkFromAddress(
        'tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3'
      )
    ).toBe('testnet-liquid')
    expect(
      inferWalletAbiNetworkFromAddress(
        'el1qq2xvpcvfup5j8zscjq05u2wxxjcyewk7979f3mmz5l7uw5pqmx6xf5xy50hsn6vhkm5euwt72x878eq6zxx2z58hd7zrsg9qn'
      )
    ).toBe('localtest-liquid')
  })
})
