import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WalletAdapter } from '@/lib/wallet/types'

/*
 * What every wallet that signs in this page owes, asked of each of the three.
 *
 * Both of these were wrong in one adapter and right in another at some point in this work, and a
 * suite that drove one of them would have said so of all three. They are asked here per wallet for
 * that reason.
 */

/** What this wallet has broadcast and not yet seen confirmed. */
const BROADCAST = ['still-in-the-mempool', 'and-another']

const RECEIVES_AT = 'tex1qwherethisaccountreceives'

const performed: Record<string, unknown>[] = []

vi.mock('@/lib/wallet/protocolActions', () => ({
  performProtocolActionLocally: (access: Record<string, unknown>) => {
    performed.push(access)

    return Promise.resolve({ txid: 'a-txid', deployment: null })
  },
}))

const session = {
  isOpen: true,
  syncing: false,
  chainUpdates: 7,
  receiveAddress: RECEIVES_AT,
  // Opening answers with the address, which is the only way a connect callback can know it: what
  // it holds of the session was captured before the session opened.
  open: vi.fn(() => Promise.resolve(RECEIVES_AT)),
  close: vi.fn(() => Promise.resolve()),
  addAssetContracts: vi.fn((pset: unknown) => Promise.resolve(pset)),
  readBalances: () => ({ total: {}, confirmed: {}, pending: {} }),
  pendingBroadcastTxids: () => BROADCAST,
  capabilities: {
    getWollet: () => Promise.resolve({}),
    getBlindedWalletUtxos: () => Promise.resolve([]),
    // Deliberately not the address: an adapter that asked the session for it here, rather than
    // taking what opening returned, is asking a copy made before the session existed.
    getReceiveAddress: () => Promise.resolve(null),
    rescan: () => Promise.resolve(),
    applyBroadcastTransaction: () => {},
  },
}

vi.mock('@/lib/wallet/wolletSession', () => ({ useWolletSession: () => session }))

const LWK = {
  lwkNetwork: { policyAsset: () => ({ toString: () => 'lbtc' }) },
  network: 'liquidtestnet',
  isTestnet: true,
  isMainnet: false,
  isRegtest: false,
}

vi.mock('@/providers/lwk/useLwk', () => ({ useOptionalLwk: () => LWK }))

vi.mock('@/constants/env', () => ({
  env: {
    VITE_DEMO_MODE: true,
    VITE_DEBUG_MNEMONIC: 'a throwaway phrase',
    VITE_NETWORK: 'liquidtestnet',
    VITE_SIDESWAP_WS_URL: 'wss://relay.invalid',
  },
}))

/** One connector shape for all three: what each hands back is the same descriptor. */
class Connector {
  connect() {
    return Promise.resolve()
  }
  disconnect() {
    return Promise.resolve()
  }
  getConnectionStatus() {
    return Promise.resolve('ready')
  }
  getDescriptor() {
    return Promise.resolve({
      id: null,
      result: Promise.resolve({ toString: () => 'ct(slip77(00),elwpkh(x))' }),
    })
  }
  signPset(pset: unknown) {
    return Promise.resolve({ id: null, result: Promise.resolve(pset) })
  }
}

vi.mock('@/lib/wallet-core/connector/seed', () => ({ SeedConnector: Connector }))
vi.mock('@/lib/wallet-core/connector/jade', () => ({ JadeConnector: Connector }))
vi.mock('@/lib/wallet-core/connector/sideswap', () => ({ SideSwapConnector: Connector }))

Object.defineProperty(navigator, 'serial', {
  configurable: true,
  value: { addEventListener: () => {}, removeEventListener: () => {}, getPorts: () => [] },
})

const { useSeedWallet } = await import('@/lib/wallet/seed/adapter')
const { useJadeWallet } = await import('@/lib/wallet/jade/adapter')
const { useSideSwapWallet } = await import('@/lib/wallet/sideswap/adapter')

const wallets: Record<string, () => WalletAdapter> = {
  seed: useSeedWallet,
  jade: useJadeWallet,
  sideswap: useSideSwapWallet,
}

beforeEach(() => {
  performed.length = 0
})

describe.each(Object.entries(wallets))('the %s wallet', (_name, useWallet) => {
  it('publishes the account it just opened, rather than reporting itself connected with none', async () => {
    const { result } = renderHook(() => useWallet())

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.state).toBe('connected')
    // The facade keys every read on this. Null here empties every screen while the button says
    // the wallet is ready.
    expect(result.current.account?.address).toBe(RECEIVES_AT)
  })

  it('publishes what its own session has taken up from the chain, and moves when it moves', () => {
    session.chainUpdates = 7

    const { result, rerender } = renderHook(() => useWallet())

    expect(result.current.chainUpdates).toBe(7)

    // A scan nobody asked for lands. What is showing this account's numbers learns of it here or
    // not at all: it goes on showing the balance from before the money arrived.
    session.chainUpdates = 8
    rerender()

    expect(result.current.chainUpdates).toBe(8)
  })

  it('tells the fee estimator what it has already broadcast', async () => {
    const { result } = renderHook(() => useWallet())

    await act(async () => {
      await result.current.connect()
    })

    await act(async () => {
      await result.current.capabilities.performAction({ action: 'ClaimPrincipal' })
    })

    expect(performed).toHaveLength(1)
    expect(performed[0]!.processingTxids).toEqual(BROADCAST)
  })
})
