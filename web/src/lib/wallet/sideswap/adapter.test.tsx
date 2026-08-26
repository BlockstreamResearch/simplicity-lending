import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * What a wallet in another application does to this one: it waits.
 *
 * A login sits with a person until they approve it there, and nothing here can hurry that. What
 * this checks is that the waiting is a fact the facade can publish rather than a promise nobody
 * can see - which request is outstanding, where it can be answered, and that giving up on it
 * stops the page waiting whatever the relay then says.
 */

const session = {
  isOpen: false,
  syncing: false,
  balances: { total: {}, confirmed: {}, pending: {} },
  receiveAddress: 'tex1qreceive',
  open: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  addAssetContracts: vi.fn((pset: unknown) => Promise.resolve(pset)),
  capabilities: {
    getWollet: () => Promise.resolve({}),
    getBlindedWalletUtxos: () => Promise.resolve([]),
    getReceiveAddress: () => Promise.resolve('tex1qreceive'),
    rescan: () => Promise.resolve(),
    applyBroadcastTransaction: () => {},
  },
}

vi.mock('@/lib/wallet/wolletSession', () => ({ useWolletSession: () => session }))

vi.mock('@/providers/lwk/useLwk', () => ({
  useOptionalLwk: () => ({
    lwkNetwork: {},
    network: 'liquidtestnet',
    isTestnet: true,
    isMainnet: false,
    isRegtest: false,
  }),
}))

vi.mock('@/constants/env', () => ({
  env: { VITE_SIDESWAP_WS_URL: 'wss://relay.invalid', VITE_NETWORK: 'liquidtestnet' },
}))

const relay = {
  approves: false,
  cancelled: [] as string[],
  disconnected: 0,
}

vi.mock('@/lib/wallet-core/connector/sideswap', () => ({
  SideSwapConnector: class {
    connect() {
      return Promise.resolve()
    }
    disconnect() {
      relay.disconnected += 1

      return Promise.resolve()
    }
    getConnectionStatus() {
      return Promise.resolve('disconnected')
    }
    getDescriptor() {
      return Promise.resolve({
        id: 'login-1',
        appLink: 'liquidconnect://login/?request_id=login-1',
        // Approved in another application, or never.
        result: relay.approves
          ? Promise.resolve({ toString: () => 'ct(slip77(00),elwpkh(x))' })
          : new Promise(() => {}),
        cancel: () => {
          relay.cancelled.push('login-1')

          return Promise.resolve()
        },
      })
    }
  },
}))

const { useSideSwapWallet } = await import('@/lib/wallet/sideswap/adapter')

beforeEach(() => {
  relay.approves = false
  relay.cancelled = []
  relay.disconnected = 0
})

describe('a wallet that has to be approved somewhere else', () => {
  it('says what it is waiting for, and where that can be answered', async () => {
    const { result } = renderHook(() => useSideSwapWallet())

    act(() => {
      void result.current.connect().catch(() => {})
    })

    await waitFor(() => expect(result.current.pendingRequest).not.toBeNull())
    expect(result.current.pendingRequest).toMatchObject({
      kind: 'login',
      requestId: 'login-1',
      appLink: 'liquidconnect://login/?request_id=login-1',
    })
    expect(result.current.state).toBe('connecting')
  })

  it('stops waiting when the request is given up on, and tells the relay after', async () => {
    const { result } = renderHook(() => useSideSwapWallet())

    act(() => {
      void result.current.connect().catch(() => {})
    })
    await waitFor(() => expect(result.current.pendingRequest).not.toBeNull())

    await act(async () => {
      await result.current.cancelPendingRequest!()
    })

    expect(result.current.pendingRequest).toBeNull()
    expect(result.current.state).toBe('disconnected')
    expect(relay.cancelled).toEqual(['login-1'])
    expect(relay.disconnected).toBe(1)
  })

  it('drops the pending request once the person approves it', async () => {
    relay.approves = true

    const { result } = renderHook(() => useSideSwapWallet())

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.pendingRequest).toBeNull()
    expect(result.current.state).toBe('connected')
  })
})
