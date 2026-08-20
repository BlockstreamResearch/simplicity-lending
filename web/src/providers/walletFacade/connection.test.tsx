import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appKit } from '@/lib/humid/appkit'
import {
  FAKE_ACCOUNT,
  FAKE_DESCRIPTOR,
  type FakeInjectedProvider,
} from '@/lib/wallet/humid/fakeProvider'
import { WALLET_NAMESPACE } from '@/lib/wallet/network'
import { installFakeExtension } from '@/test/appkitEnvironment'

import { useWallet } from './useWallet'
import { WalletFacadeProvider } from './WalletFacadeProvider'

/*
 * An address and its script are derived from the approved descriptor by the chain library, which
 * is a WebAssembly module loaded in a browser. This is not a browser, so the derivation is stood
 * in for and what the test proves is the wiring: the descriptor the wallet approved is what the
 * facade derives from, rather than the identifier the wallet calls the account.
 */
vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: (descriptor: string) => Promise.resolve(`script:${descriptor}`),
}))

let outcome: string | null = null

function Probe() {
  const wallet = useWallet()

  return (
    <div>
      <span data-testid='status'>{wallet.connectionStatus}</span>
      <span data-testid='account'>{wallet.account ?? ''}</span>
      <span data-testid='script'>{wallet.scriptPubkey ?? ''}</span>
      <span data-testid='error'>{wallet.isError ? wallet.error : ''}</span>
      <button
        type='button'
        onClick={() => {
          outcome = null
          wallet
            .connect()
            .then(() => {
              outcome = 'connected'
            })
            .catch((error: Error) => {
              outcome = `refused: ${error.message}`
            })
        }}
      >
        connect
      </button>
    </div>
  )
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <WalletFacadeProvider>
        <Probe />
      </WalletFacadeProvider>
    </QueryClientProvider>,
  )
}

async function pressConnect() {
  await act(async () => {
    screen.getByText('connect').click()
  })
}

let wallet: FakeInjectedProvider

beforeEach(async () => {
  outcome = null
  wallet = installFakeExtension()
  // The connection layer is one object for the whole file, as it is for a whole page. Each test
  // starts from a page nothing is connected on.
  await act(async () => {
    await appKit.disconnect(WALLET_NAMESPACE).catch(() => {})
  })
})

afterEach(() => {
  cleanup()
})

describe('connecting the dapp to the wallet', () => {
  it('asks the wallet for a session and puts the account it returns on the screen', async () => {
    renderProbe()

    await pressConnect()

    await waitFor(() => expect(screen.getByTestId('account').textContent).toBe(FAKE_ACCOUNT))
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(outcome).toBe('connected')
    expect(wallet.calls).toContain('wallet_createSession')
  })

  it('identifies the account by the script the approved descriptor hands out', async () => {
    renderProbe()

    await pressConnect()

    await waitFor(() =>
      expect(screen.getByTestId('script').textContent).toBe(`script:${FAKE_DESCRIPTOR}`),
    )
  })

  it('reports a refusal instead of waiting on it, and stays disconnected', async () => {
    renderProbe()
    wallet.refuseNextSession('The person declined the connection.')

    await pressConnect()

    await waitFor(() => expect(outcome).not.toBeNull())
    expect(outcome).toMatch(/^refused: /)
    expect(screen.getByTestId('status').textContent).toBe('disconnected')
    expect(screen.getByTestId('account').textContent).toBe('')
    await waitFor(() => expect(screen.getByTestId('error').textContent).not.toBe(''))
  })

  it('connects on a second attempt after the first was refused', async () => {
    renderProbe()
    wallet.refuseNextSession('The person declined the connection.')

    await pressConnect()
    await waitFor(() => expect(outcome).toMatch(/^refused: /))

    await pressConnect()

    await waitFor(() => expect(screen.getByTestId('account').textContent).toBe(FAKE_ACCOUNT))
    expect(outcome).toBe('connected')
    expect(wallet.calls.filter(call => call === 'wallet_createSession')).toHaveLength(2)
  })

  it('leaves an unanswered approval pending rather than settling it either way', async () => {
    renderProbe()
    wallet.hangNextSession()

    await pressConnect()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(outcome).toBeNull()
    expect(screen.getByTestId('status').textContent).toBe('disconnected')
    expect(screen.getByTestId('error').textContent).toBe('')
  })
})
