import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { SessionTypes, SignClientTypes } from '@walletconnect/types'
import {
  awaitWalletAbiApprovedSession,
  createWalletAbiCaipNetwork,
  createWalletAbiMetadata,
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

function createMockApprovalSignClient(initialSessions: SessionTypes.Struct[] = []) {
  const emitter = new EventEmitter()
  const sessions = [...initialSessions]

  return {
    signClient: {
      session: {
        getAll() {
          return [...sessions]
        },
      },
      on(
        event: 'session_connect',
        listener: (event: SignClientTypes.EventArguments['session_connect']) => void
      ) {
        emitter.on(event, listener)
      },
      off(
        event: 'session_connect',
        listener: (event: SignClientTypes.EventArguments['session_connect']) => void
      ) {
        emitter.off(event, listener)
      },
    },
    addSession(session: SessionTypes.Struct) {
      sessions.unshift(session)
    },
    emitSessionConnect(session: SessionTypes.Struct) {
      sessions.unshift(session)
      emitter.emit('session_connect', { session })
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

  it('includes a redirect target in WalletConnect metadata for mobile handoff', () => {
    expect(createWalletAbiMetadata('https://app.example/connect?wallet=green')).toEqual({
      name: 'Simplicity Lending',
      description: 'Wallet ABI WalletConnect session for the Simplicity Lending web app.',
      url: 'https://app.example/connect?wallet=green',
      icons: ['https://app.example/vite.svg'],
      redirect: {
        universal: 'https://app.example/connect?wallet=green',
      },
    })
  })

  it('accepts session_connect as a fallback when approval does not settle', async () => {
    const chainId = 'walabi:testnet-liquid'
    const { signClient, emitSessionConnect } = createMockApprovalSignClient()
    const connectedSession = sessionWith({
      topic: 'connected',
      expiry: 50,
      chainId,
    })

    const approval = awaitWalletAbiApprovedSession({
      approval: () => new Promise(() => undefined),
      signClient,
      chainId,
      connectTimeoutMs: 500,
      sessionPollMs: 5,
    })

    setTimeout(() => {
      emitSessionConnect(connectedSession)
    }, 10)

    await expect(approval).resolves.toMatchObject({
      topic: 'connected',
    })
  })

  it('falls back to the stored session when approval rejects after the wallet settles', async () => {
    const chainId = 'walabi:testnet-liquid'
    const { signClient, addSession } = createMockApprovalSignClient()
    const settledSession = sessionWith({
      topic: 'settled',
      expiry: 60,
      chainId,
    })

    const approval = awaitWalletAbiApprovedSession({
      approval: async () => {
        setTimeout(() => {
          addSession(settledSession)
        }, 10)
        throw new Error('approval promise failed')
      },
      signClient,
      chainId,
      connectTimeoutMs: 500,
      approvalRejectionGraceMs: 50,
      sessionPollMs: 5,
    })

    await expect(approval).resolves.toMatchObject({
      topic: 'settled',
    })
  })

  it('does not treat a stored session as approved before approval settles', async () => {
    const chainId = 'walabi:testnet-liquid'
    const { signClient, addSession } = createMockApprovalSignClient()
    const storedSession = sessionWith({
      topic: 'stored-only',
      expiry: 70,
      chainId,
    })

    const approval = awaitWalletAbiApprovedSession({
      approval: () => new Promise(() => undefined),
      signClient,
      chainId,
      connectTimeoutMs: 50,
      sessionPollMs: 5,
    })

    setTimeout(() => {
      addSession(storedSession)
    }, 10)

    await expect(approval).rejects.toThrow('WalletConnect session approval timed out')
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
