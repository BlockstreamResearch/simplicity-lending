import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor as waitForDefault } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WalletAdapter, WalletCapabilities } from '@/lib/wallet/types'

import { useWallet } from './useWallet'

/*
 * Two wallets, neither of them real: one that can be asked about its own outputs and one that
 * cannot. What is under test is the facade's dispatch — that a member the connected wallet serves
 * reaches it, and that one it does not serve is refused in its name rather than answered by this
 * file, which is what the facade did for every wallet when there was only one.
 */
vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: () => Promise.resolve('script'),
}))

/*
 * The connection layer starts up once per test file, before anything here renders, and on a busy
 * machine that start-up alone can outlast the one second `waitFor` allows by default. The wait is
 * for this file's own assertions, not for that, so it is given room.
 */
const waitFor: typeof waitForDefault = (callback, options) =>
  waitForDefault(callback, { timeout: 5_000, ...options })

const served = {
  wollet: { name: 'the wallet object' },
  utxos: [{ name: 'a blinded output' }],
  signed: { name: 'a signed transaction' },
}

const calls: string[] = []

function baseCapabilities(): WalletCapabilities {
  return {
    getWalletDescriptor: () => Promise.resolve('a descriptor'),
    getBalance: () => Promise.resolve({ total: '0', confirmed: null, pending: null }),
    getUtxos: () => Promise.resolve([]),
    performAction: () => Promise.resolve(null),
  }
}

/** An account holding more than has confirmed, which is the case the screens get wrong. */
const HELD = { total: '100', confirmed: '40', pending: '60' }

/** What the chain currently says, which a scan can move without anybody asking. */
let chain = HELD

/** A wallet whose outputs this page can see: it serves every optional member. */
function wolletBacked(): WalletCapabilities {
  return {
    ...baseCapabilities(),
    getBalance: () => Promise.resolve(chain),
    getWollet: () => {
      calls.push('getWollet')

      return Promise.resolve(served.wollet as never)
    },
    getBlindedWalletUtxos: () => {
      calls.push('getBlindedWalletUtxos')

      return Promise.resolve(served.utxos as never)
    },
    getReceiveAddress: () => Promise.resolve('tex1qreceive'),
    rescan: () => {
      calls.push('rescan')

      return Promise.resolve()
    },
    signPset: () => {
      calls.push('signPset')

      return Promise.resolve(served.signed as never)
    },
    applyBroadcastTransaction: () => {
      calls.push('applyBroadcastTransaction')
    },
  }
}

function adapterWith(capabilities: WalletCapabilities): WalletAdapter {
  return {
    id: 'stub',
    signerType: 'seed',
    name: 'A stub wallet',
    isAvailable: true,
    unavailableReason: null,
    state: 'connected',
    account: { address: 'an account', chainId: 'bip122:1' },
    restoring: false,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    openAccount: () => {},
    capabilities,
  }
}

let adapter: WalletAdapter = adapterWith(baseCapabilities())

vi.mock('@/lib/wallet/adapters', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/wallet/adapters')>('@/lib/wallet/adapters')

  return { ...actual, useWalletAdapters: () => [adapter] }
})

let answers: Record<string, string> = {}

function Probe() {
  const wallet = useWallet()

  const record = (what: string, run: () => Promise<unknown>) => () => {
    run()
      .then(result => {
        answers[what] = JSON.stringify(result)
      })
      .catch((error: Error) => {
        answers[what] = `refused: ${error.message}`
      })
  }

  return (
    <div>
      <span data-testid='signer'>{wallet.signerType ?? ''}</span>
      <span data-testid='receive'>{wallet.receiveAddress ?? ''}</span>
      <span data-testid='confirmed'>{JSON.stringify(wallet.confirmedBalances)}</span>
      <span data-testid='pending'>{JSON.stringify(wallet.pendingBalances)}</span>
      <button type='button' onClick={record('getWollet', () => wallet.getWollet())}>
        getWollet
      </button>
      <button
        type='button'
        onClick={record('getBlindedWalletUtxos', () => wallet.getBlindedWalletUtxos())}
      >
        getBlindedWalletUtxos
      </button>
      <button type='button' onClick={record('signPset', () => wallet.signPset({} as never))}>
        signPset
      </button>
      <button type='button' onClick={record('getReceiveAddress', () => wallet.getReceiveAddress())}>
        getReceiveAddress
      </button>
      <button type='button' onClick={record('syncWallet', () => wallet.syncWallet())}>
        syncWallet
      </button>
      <button
        type='button'
        onClick={() => {
          wallet.applyBroadcastTransaction({} as never)
        }}
      >
        applyBroadcastTransaction
      </button>
    </div>
  )
}

/*
 * One query client per test, as a page has one.
 *
 * Built per render, every render threw the reads away and started again, which hid what this file
 * is about: whether an invalidation reaches the screens.
 */
function harnessFor(queryClient: QueryClient) {
  return function Harness({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

async function renderProbe() {
  const { WalletFacadeProvider } = await import('./WalletFacadeProvider')
  const Harness = harnessFor(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  // A fresh element each time: re-rendering the identical one is a render React can skip.
  const tree = () => (
    <Harness>
      <WalletFacadeProvider>
        <Probe />
      </WalletFacadeProvider>
    </Harness>
  )
  const { rerender } = render(tree())

  return () => {
    rerender(tree())
  }
}

async function press(label: string) {
  await act(async () => {
    screen.getByText(label).click()
  })
}

beforeEach(() => {
  calls.length = 0
  answers = {}
  chain = HELD
})

afterEach(() => {
  cleanup()
})

describe('a wallet that can be asked about its own outputs', () => {
  beforeEach(() => {
    adapter = adapterWith(wolletBacked())
  })

  it('hands out the wallet object and the blinded outputs it was asked for', async () => {
    await renderProbe()

    await press('getWollet')
    await press('getBlindedWalletUtxos')

    await waitFor(() => expect(answers.getWollet).toBe(JSON.stringify(served.wollet)))
    expect(answers.getBlindedWalletUtxos).toBe(JSON.stringify(served.utxos))
  })

  it('signs a transaction this page built', async () => {
    await renderProbe()

    await press('signPset')

    await waitFor(() => expect(answers.signPset).toBe(JSON.stringify(served.signed)))
  })

  it('answers where the account receives, rather than that there is nowhere to ask', async () => {
    await renderProbe()

    await press('getReceiveAddress')

    await waitFor(() => expect(answers.getReceiveAddress).toBe(JSON.stringify('tex1qreceive')))
  })

  it('rereads the chain when asked to sync, before asking what the account holds', async () => {
    await renderProbe()

    await press('syncWallet')

    await waitFor(() => expect(calls).toContain('rescan'))
  })

  it('is named as the signer by what it says it is, not by the wallet this dapp started with', async () => {
    await renderProbe()

    await waitFor(() => expect(screen.getByTestId('signer').textContent).toBe('seed'))
  })

  it('says where the account receives, so what follows a broadcast has somewhere to report it', async () => {
    await renderProbe()

    await waitFor(() => expect(screen.getByTestId('receive').textContent).toBe('tex1qreceive'))
  })

  it('keeps what has confirmed apart from what has not, because only one of them can be spent', async () => {
    await renderProbe()

    // The account holds 100 and 40 of it has confirmed. A screen told 100 is spendable enables an
    // action that then refuses, because input selection spends confirmed outputs only.
    await waitFor(() => expect(screen.getByTestId('confirmed').textContent).toContain('"40"'))
    expect(screen.getByTestId('pending').textContent).toContain('"60"')
  })

  it('reports a wallet that does not split its balance as wholly confirmed, as it always has', async () => {
    adapter = adapterWith(baseCapabilities())

    await renderProbe()

    // `confirmed: null` is "this wallet does not say", which is not zero — the extension answers
    // with one number and the screens have always read it as spendable.
    await waitFor(() => expect(screen.getByTestId('confirmed').textContent).toContain('"0"'))
    expect(screen.getByTestId('pending').textContent).toBe('{}')
  })

  it('shows what a chain reread found, without waiting to be asked for a sync', async () => {
    const again = await renderProbe()

    await waitFor(() => expect(screen.getByTestId('confirmed').textContent).toContain('"40"'))

    // Money arrives while the tab sits there, and the wallet's own timer finds it. Nothing asked
    // for this, so nothing above knows unless the wallet says its answers have moved.
    chain = { total: '250', confirmed: '250', pending: '0' }
    adapter = { ...adapter, chainUpdates: (adapter.chainUpdates ?? 0) + 1 }

    await act(async () => {
      again()
    })

    await waitFor(() => expect(screen.getByTestId('confirmed').textContent).toContain('"250"'))
  })

  it('takes up a just-broadcast transaction instead of waiting for the next scan', async () => {
    await renderProbe()

    await press('applyBroadcastTransaction')

    await waitFor(() => expect(calls).toContain('applyBroadcastTransaction'))
  })
})

describe('no wallet connected at all', () => {
  beforeEach(() => {
    adapter = { ...adapterWith(baseCapabilities()), state: 'disconnected', account: null }
  })

  it('says nothing is connected, rather than something about a wallet that is not there', async () => {
    await renderProbe()

    await press('getWollet')

    await waitFor(() => expect(answers.getWollet).toContain('refused:'))
    expect(answers.getWollet).toContain('Connect a wallet before')
  })
})

describe('a wallet that holds the descriptor itself', () => {
  beforeEach(() => {
    adapter = adapterWith(baseCapabilities())
  })

  it('refuses each in-page member by name, saying why that wallet cannot', async () => {
    await renderProbe()

    await press('getWollet')
    await press('getBlindedWalletUtxos')
    await press('signPset')

    await waitFor(() => expect(answers.getWollet).toContain('refused:'))
    expect(answers.getWollet).toContain('hand out a wallet object')
    expect(answers.getBlindedWalletUtxos).toContain('list blinded outputs')
    expect(answers.signPset).toContain('sign a transaction built here')
  })

  it('says there is nowhere to ask where the account receives', async () => {
    await renderProbe()

    await press('getReceiveAddress')

    await waitFor(() => expect(answers.getReceiveAddress).toBe(JSON.stringify(null)))
  })

  it('syncs without a rescan, because there is no local output set to reread', async () => {
    await renderProbe()

    await press('syncWallet')

    expect(calls).not.toContain('rescan')
  })
})
