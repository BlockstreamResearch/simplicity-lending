import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakeInjectedProvider, FAKE_ACCOUNT } from '@/lib/wallet/humid/fakeProvider'
import { rememberPreviousConnection } from '@/test/appkitEnvironment'

vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: (descriptor: string) => Promise.resolve(`script:${descriptor}`),
}))

afterEach(() => {
  cleanup()
})

/**
 * A reload is the common case, not an edge one: a person approves once and then opens the dapp
 * again. The wallet still holds the approval, so the account has to come back without a second
 * approval window. This file imports the connection layer only inside the test, so the session
 * is already on the page when the layer is built — which is the order a reload happens in.
 */
describe('opening the dapp again while the wallet still holds the approval', () => {
  it('shows the account without asking for a second approval', async () => {
    const wallet = createFakeInjectedProvider()

    wallet.grantExistingSession()
    window.humid = wallet
    rememberPreviousConnection()

    const { WalletFacadeProvider } = await import('./WalletFacadeProvider')
    const { useWallet } = await import('./useWallet')

    function Probe() {
      const { account, connectionStatus } = useWallet()

      return (
        <div>
          <span data-testid='status'>{connectionStatus}</span>
          <span data-testid='account'>{account ?? ''}</span>
        </div>
      )
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WalletFacadeProvider>
          <Probe />
        </WalletFacadeProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('account').textContent).toBe(FAKE_ACCOUNT), {
      timeout: 5_000,
    })
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(wallet.calls).toContain('wallet_getSession')
    expect(wallet.calls).not.toContain('wallet_createSession')
  })
})
