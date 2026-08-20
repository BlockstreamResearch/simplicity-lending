import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCreateOfferAction } from '@/hooks/useCreateOfferAction'
import { appKit } from '@/lib/humid/appkit'
import { type FakeInjectedProvider } from '@/lib/wallet/humid/fakeProvider'
import { WALLET_NAMESPACE } from '@/lib/wallet/network'
import { TxProgressProvider } from '@/providers/txProgress/TxProgressProvider'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { WalletFacadeProvider } from '@/providers/walletFacade/WalletFacadeProvider'
import { installFakeExtension } from '@/test/appkitEnvironment'

/**
 * Creating a lending offer, as the wallet is asked for it.
 *
 * The page chose four numbers and knows which factory this account borrows through. Everything
 * else — which outputs pay for it, where each one lands, what the covenant addresses are — is
 * the wallet's, so what is proved here is the request: the parameters as the document names
 * them, and the factory covenant the action spends.
 */

vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: (descriptor: string) => Promise.resolve(`script:${descriptor}`),
}))

const FACTORY_ASSET = 'ab'.repeat(32)
const FACTORY_TXID = 'cd'.repeat(32)
const TIP_HEIGHT = 3_200_000

vi.mock('@/api/esplora/methods', () => ({
  fetchLatestBlockHeight: () => Promise.resolve(TIP_HEIGHT),
}))

vi.mock('@/api/indexer/hooks', () => ({
  useFactories: () => ({
    data: [
      {
        factory_asset_id: FACTORY_ASSET,
        auth_utxo: { txid: FACTORY_TXID, vout: 0 },
        program_utxo: { txid: FACTORY_TXID, vout: 1 },
      },
    ],
  }),
}))

function Probe() {
  const wallet = useWallet()
  const createOffer = useCreateOfferAction()
  const [outcome, setOutcome] = useState<string | null>(null)

  return (
    <div>
      <span data-testid='outcome'>{outcome ?? ''}</span>
      <button
        type='button'
        onClick={() => {
          void wallet.connect().catch(() => {})
        }}
      >
        connect
      </button>
      <button
        type='button'
        onClick={() => {
          createOffer({
            collateralAmount: 100_000n,
            loanDurationBlocks: 4_320,
            principalAmount: 5_000n,
            principalInterestRateBps: 500,
          })
            .then(result => {
              setOutcome(`sent: ${result.txid}`)
            })
            .catch((error: Error) => {
              setOutcome(`refused: ${error.message}`)
            })
        }}
      >
        create offer
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

describe('creating a lending offer', () => {
  it('names every parameter the document asks for, and none it answers itself', async () => {
    wallet.performsAction({ broadcast: true, feeSats: '600', transactionHex: '02', txid: 'off1' })
    renderProbe()
    await press('connect')
    await press('create offer')

    await waitFor(() => {
      expect(wallet.actionRequests).toHaveLength(1)
    })

    const request = wallet.actionRequests[0] as {
      action: string
      params: Record<string, string>
      state: { utxos: { txid: string; utxo_type: string; vout: number }[] }
    }

    expect(request.action).toBe('CreateOffer')
    expect(request.params).toEqual({
      COLLATERAL_AMOUNT: '100000',
      COLLATERAL_ASSET_ID: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
      FACTORY_ASSET_ID: FACTORY_ASSET,
      // The document calls this a liquidation height, so the term a person chose in days is
      // added to the chain's tip rather than sent as a duration.
      LOAN_EXPIRATION_TIME: String(TIP_HEIGHT + 4_320),
      PRINCIPAL_AMOUNT: '5000',
      PRINCIPAL_ASSET_ID: '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
      PRINCIPAL_INTEREST_RATE: '500',
      PROTOCOL_FEE_KEEPER_ASSET_ID:
        '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
    })
  })

  it('locates the factory covenant this offer is minted from', async () => {
    wallet.performsAction({ broadcast: true, feeSats: '600', transactionHex: '02', txid: 'off1' })
    renderProbe()
    await press('connect')
    await press('create offer')

    await waitFor(() => {
      expect(wallet.actionRequests).toHaveLength(1)
    })

    const request = wallet.actionRequests[0] as {
      state: { utxos: { txid: string; utxo_type: string; vout: number }[] }
    }

    expect(request.state.utxos).toEqual([
      { txid: FACTORY_TXID, utxo_type: 'issuance_factory', vout: 1 },
    ])
  })

  it('reports the transaction the wallet sent', async () => {
    wallet.performsAction({ broadcast: true, feeSats: '600', transactionHex: '02', txid: 'off1' })
    renderProbe()
    await press('connect')
    await press('create offer')

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toBe('sent: off1')
    })
  })
})
