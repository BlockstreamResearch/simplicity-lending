import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The seed wallet over the real chain session, with only the chain itself stood in.
 *
 * Three things here are the kind that go wrong quietly. The account's own blinding key must not
 * leave the wallet layer, because anything holding it can unblind every output the account owns.
 * A protocol action must actually reach the dispatch — nothing else in the suite drives it, so a
 * wallet that silently performed nothing would look exactly like this file passing. And what the
 * adapter serves must keep its identity while the chain is reread, or the facade derives the
 * account's script again every minute, for an account that has not moved.
 */

/** A real-shaped descriptor: a blinding key that is the account's, and must not be published. */
const REAL_BLINDING_KEY = 'aa'.repeat(32)
const DESCRIPTOR = `ct(slip77(${REAL_BLINDING_KEY}),elwpkh([73c5da0a/84h/1h/0h]tpub/<0;1>/*))#checksum`

const performed: { access?: Record<string, unknown> }[] = []

vi.mock('@/lib/wallet/protocolActions', () => ({
  performProtocolActionLocally: (access: Record<string, unknown>) => {
    performed.push({ access })

    return Promise.resolve({ txid: 'a-txid', deployment: null })
  },
}))

vi.mock('@/constants/env', () => ({
  env: {
    VITE_DEMO_MODE: true,
    VITE_DEBUG_MNEMONIC: '',
    VITE_NETWORK: 'liquidtestnet',
  },
}))

// One object for the whole file, as a React context value is: a mock that built a new one on
// every render would make everything downstream look unstable when it is not.
vi.mock('@/providers/lwk/useLwk', () => {
  const lwk = {
    lwkNetwork: { policyAsset: () => ({ toString: () => 'lbtc' }) },
    network: 'liquidtestnet',
    isTestnet: true,
    isMainnet: false,
    isRegtest: false,
  }

  return { useOptionalLwk: () => lwk }
})

/** The chain library's wallet object, as far as the session touches it. */
const freed: string[] = []

const wollet = {
  address: () => ({
    address: () => ({ toString: () => 'tex1qreceive', free: () => freed.push('Address') }),
    free: () => freed.push('AddressResult'),
  }),
  utxos: () => [],
  balance: () => new Map(),
  assetsOwned: () => ({ toString: () => 'owned' }),
  applyTransaction: () => {},
  txDetails: () => undefined,
  free: () => freed.push('Wollet'),
}

vi.mock('@/lib/wallet-core/store/walletCache', () => ({
  createCachedWollet: () =>
    Promise.resolve({
      wollet,
      cache: { close: () => Promise.resolve(), clearAndClose: () => Promise.resolve() },
    }),
}))

/** A fresh object each time, as a real read is: the session's state genuinely moves on a rescan. */
const balances = () => ({ total: { lbtc: '7' }, confirmed: { lbtc: '5' }, pending: { lbtc: '2' } })

vi.mock('@/lib/wallet-core/wallet/sync', () => ({
  syncBalances: () => Promise.resolve(balances()),
  readWalletBalances: () => balances(),
  reconcilePendingBroadcasts: () => [],
  applyBroadcastTransaction: () => balances(),
}))

vi.mock('@/lwk', () => ({ createEsploraClient: () => ({ name: 'esplora' }) }))

vi.mock('@lilbonekit/lwk-web', () => ({
  Registry: { defaultForNetwork: () => Promise.resolve({ addContracts: (p: unknown) => p }) },
}))

vi.mock('@/lib/wallet-core/connector/seed', () => ({
  SeedConnector: class {
    connect() {
      return Promise.resolve()
    }
    disconnect() {
      return Promise.resolve()
    }
    getDescriptor() {
      return Promise.resolve({ id: null, result: Promise.resolve({ toString: () => DESCRIPTOR }) })
    }
    signPset(pset: unknown) {
      return Promise.resolve({ id: null, result: Promise.resolve(pset) })
    }
  },
}))

const { useSeedWallet } = await import('@/lib/wallet/seed/adapter')

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon about x y'

beforeEach(() => {
  performed.length = 0
  freed.length = 0
})

describe('a wallet whose key is a phrase this page holds', () => {
  it('publishes a descriptor the account’s outputs cannot be unblinded with', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    const published = await result.current.capabilities.getWalletDescriptor()

    expect(published).not.toContain(REAL_BLINDING_KEY)
    // Still a descriptor a script can be derived from — the blinding key is replaced, not removed.
    expect(published).toMatch(/^ct\(slip77\(0{63}1\),elwpkh\(/u)
  })

  it('publishes the account its own session just opened', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    // Over the real session rather than a stand-in for it: what open() answers with is what the
    // wallet publishes, and the facade keys every read on it.
    expect(result.current.state).toBe('connected')
    expect(result.current.account?.address).toBe('tex1qreceive')
  })

  it('takes up a chain reread nobody asked for, and says that it did', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    const before = result.current.chainUpdates

    // What the session's own timer does while a tab sits there.
    await act(async () => {
      await result.current.capabilities.rescan!()
    })

    // The number means nothing; that it moved is what tells whatever is showing the balances to
    // ask again, instead of showing the scan before last until somebody presses something.
    expect(result.current.chainUpdates).toBeGreaterThan(before ?? 0)
  })

  it('says so when a just-broadcast transaction moves what the account holds', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    const before = result.current.chainUpdates ?? 0

    act(() => {
      result.current.capabilities.applyBroadcastTransaction!({
        txid: () => ({ toString: () => 'just-sent' }),
      } as never)
    })

    // Taking a transaction up moves the balances without a scan, and whatever is showing them has
    // to hear about it the same way it hears about a scan.
    expect(result.current.chainUpdates).toBeGreaterThan(before)
  })

  it('performs a protocol action through the dispatch, over its own chain session', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    const answer = await result.current.capabilities.performAction({ action: 'CancelOffer' })

    expect(performed).toHaveLength(1)
    expect(answer).toEqual({ txid: 'a-txid', deployment: null })

    const access = performed[0]!.access!

    // The wallet's own chain session is what the builders are given, and the signature is this
    // wallet's: a dispatch handed anything else would build against another account's outputs.
    expect(typeof access.getWollet).toBe('function')
    expect(typeof access.signPset).toBe('function')
    expect(await (access.getReceiveAddress as () => Promise<string>)()).toBe('tex1qreceive')
    // Nothing has been broadcast yet, so there is nothing for a fee to have to beat.
    expect(access.processingTxids).toEqual([])
  })

  it('tells the fee estimator what it has already broadcast, so a retry can beat it', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    // One transaction sent and not yet seen confirmed, taken up the way a broadcast takes it up.
    act(() => {
      result.current.capabilities.applyBroadcastTransaction!({
        txid: () => ({ toString: () => 'already-sent' }),
      } as never)
    })

    await result.current.capabilities.performAction({ action: 'CancelOffer' })

    expect(performed.at(-1)!.access!.processingTxids).toEqual(['already-sent'])
  })

  it('gives back the Rust memory its session took, when the account is given up', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    await act(async () => {
      await result.current.disconnect()
    })

    // A scanned wallet is the largest thing this page holds outside the collector's reach, and a
    // person switching wallets would otherwise leave one behind each time.
    expect(freed).toContain('Wollet')
    expect(freed).toContain('Address')
    expect(freed).toContain('AddressResult')
  })

  it('reports what has confirmed apart from what the account holds in total', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    await expect(result.current.capabilities.getBalance('lbtc')).resolves.toEqual({
      total: '7',
      confirmed: '5',
      pending: '2',
    })
  })

  it('keeps what it serves identical while the chain is reread', async () => {
    const { result } = renderHook(() => useSeedWallet())

    await act(async () => {
      await result.current.connect({ mnemonic: PHRASE })
    })

    const beforeRescan = result.current.capabilities

    // What the 60-second timer and every window focus do. Nothing about the account changed.
    await act(async () => {
      await result.current.capabilities.rescan!()
    })

    // A new object here is a new descriptor parse and a new wallet build at the facade, once a
    // minute, for an account that has not moved.
    expect(result.current.capabilities).toBe(beforeRescan)
  })
})
