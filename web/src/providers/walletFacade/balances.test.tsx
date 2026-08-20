import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NETWORK_CONFIG } from '@/constants/network-config'
import { appKit } from '@/lib/humid/appkit'
import { walletAssetId } from '@/lib/wallet/humid/assetId'
import { type FakeInjectedProvider } from '@/lib/wallet/humid/fakeProvider'
import { WALLET_NAMESPACE } from '@/lib/wallet/network'
import { installFakeExtension } from '@/test/appkitEnvironment'

import { useWallet } from './useWallet'
import { WalletFacadeProvider } from './WalletFacadeProvider'

vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: (descriptor: string) => Promise.resolve(`script:${descriptor}`),
}))

const COLLATERAL = NETWORK_CONFIG.collateralAsset.id

function Probe() {
  const wallet = useWallet()

  return (
    <div>
      <span data-testid='status'>{wallet.connectionStatus}</span>
      <span data-testid='collateral'>{wallet.confirmedBalances[COLLATERAL] ?? ''}</span>
      <span data-testid='unavailable'>{wallet.balancesUnavailableReason ?? ''}</span>
      <button
        type='button'
        onClick={() => {
          void wallet.connect().catch(() => {})
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

async function connect() {
  await act(async () => {
    screen.getByText('connect').click()
  })
}

let wallet: FakeInjectedProvider

beforeEach(async () => {
  wallet = installFakeExtension()
  await act(async () => {
    await appKit.disconnect(WALLET_NAMESPACE).catch(() => {})
  })
})

afterEach(() => {
  cleanup()
})

describe('reading what the account holds', () => {
  /*
   * The wallet names an asset by its chain as well as by itself and refuses anything else before
   * it looks at an account at all. This dapp carries bare identifiers, so something has to
   * qualify them, and the fake refuses exactly as the wallet does when nothing has.
   */
  it('asks for an asset by the name the wallet accepts', async () => {
    wallet.holds(walletAssetId(COLLATERAL), '107922')
    renderProbe()
    await connect()

    await waitFor(() => {
      expect(screen.getByTestId('collateral').textContent).toBe('107922')
    })

    expect(wallet.balanceAsks[0]).toBe(walletAssetId(COLLATERAL))
    expect(wallet.balanceAsks[0]).toMatch(/^bip122:[0-9a-f]{32}\/elip144:[0-9a-f]{64}$/u)
  })

  /*
   * The failure this whole file exists for. A balance the wallet did not answer used to leave no
   * entry, and an account holding nothing leaves no entry either, so a refusal was rendered as a
   * balance of zero and hid itself.
   */
  it('says the balances are not known when the wallet refuses, instead of showing nothing', async () => {
    wallet.refuseBalances('The dapp may not view this balance.')
    renderProbe()
    await connect()

    await waitFor(() => {
      expect(screen.getByTestId('unavailable').textContent).toContain('did not answer')
    })

    expect(screen.getByTestId('unavailable').textContent).toContain(
      'The dapp may not view this balance.',
    )
    expect(screen.getByTestId('collateral').textContent).toBe('')
  })

  /* An account that genuinely holds nothing is a different sentence, and stays a number. */
  it('reports a real zero as a balance rather than as a failure', async () => {
    wallet.holds(walletAssetId(COLLATERAL), '0')
    renderProbe()
    await connect()

    await waitFor(() => {
      expect(screen.getByTestId('collateral').textContent).toBe('0')
    })

    expect(screen.getByTestId('unavailable').textContent).toBe('')
  })
})
