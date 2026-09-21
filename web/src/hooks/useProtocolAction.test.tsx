import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProtocolAction } from '@/hooks/useProtocolAction'
import { appKit } from '@/lib/humid/appkit'
import { type FakeInjectedProvider } from '@/lib/wallet/humid/fakeProvider'
import { WALLET_NAMESPACE } from '@/lib/wallet/network'
import { TxProgressProvider } from '@/providers/txProgress/TxProgressProvider'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { WalletFacadeProvider } from '@/providers/walletFacade/WalletFacadeProvider'
import { installFakeExtension } from '@/test/appkitEnvironment'

/**
 * Performing one action of the deployed protocol.
 *
 * The page builds no transaction: it hands the wallet the document, the contracts and the
 * action, and the wallet does the rest. What is proved here is the whole path from a screen to
 * the provider the extension injects — the request as it arrives, and the answer as it returns.
 */

vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: (descriptor: string) => Promise.resolve(`script:${descriptor}`),
}))

function Probe() {
  const wallet = useWallet()
  const performProtocolAction = useProtocolAction()
  const [outcome, setOutcome] = useState<string | null>(null)

  return (
    <div>
      <span data-testid='outcome'>{outcome ?? ''}</span>
      <button
        type='button'
        onClick={() => {
          // The probe presses the first wallet the facade offers, which is what a person does:
          // the picker's cards are that list.
          const [first] = wallet.wallets

          if (first) void wallet.connect(first.id).catch(() => {})
        }}
      >
        connect
      </button>
      <button
        type='button'
        onClick={() => {
          setOutcome(null)
          performProtocolAction({ action: 'CreateFactory' })
            .then(result => {
              setOutcome(`sent: ${result.txid}`)
            })
            .catch((error: Error) => {
              setOutcome(`refused: ${error.message}`)
            })
        }}
      >
        perform
      </button>
    </div>
  )
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <TxProgressProvider>
        <WalletFacadeProvider>
          <Probe />
        </WalletFacadeProvider>
      </TxProgressProvider>
    </QueryClientProvider>,
  )
}

async function press(label: string) {
  await act(async () => {
    screen.getByText(label).click()
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

describe('performing one action of the protocol', () => {
  it('asks the wallet to build, check and send it, from the document itself', async () => {
    wallet.performsAction({ broadcast: true, feeSats: '250', transactionHex: '02', txid: 'abc' })
    renderProbe()
    await press('connect')
    await press('perform')

    await waitFor(() => {
      expect(wallet.actionRequests).toHaveLength(1)
    })

    const request = wallet.actionRequests[0] as {
      action: string
      broadcast: boolean
      contractSources: Record<string, string>
      manifest: { protocol?: string }
    }

    expect(request.action).toBe('CreateFactory')
    expect(request.broadcast).toBe(true)
    expect(request.manifest.protocol).toBe('simplicity-lending')
    // The real contracts, under the paths the document references them by.
    expect(request.contractSources['./issuance_factory.simf']).toContain('fn main')
  })

  it('reports the transaction the wallet sent', async () => {
    wallet.performsAction({ broadcast: true, feeSats: '250', transactionHex: '02', txid: 'abc' })
    renderProbe()
    await press('connect')
    await press('perform')

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toBe('sent: abc')
    })
  })

  it('carries a refusal from the wallet back as the failure it is', async () => {
    wallet.refuseActions('The person rejected the request.')
    renderProbe()
    await press('connect')
    await press('perform')

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toContain('rejected the request')
    })
  })

  it('refuses an answer with no transaction in it, rather than reporting an empty one', async () => {
    wallet.performsAction({ broadcast: false, feeSats: '250', transactionHex: '02' })
    renderProbe()
    await press('connect')
    await press('perform')

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toContain('refused:')
    })
    expect(screen.getByTestId('outcome').textContent).toContain('no transaction id')
  })
})
