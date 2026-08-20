import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAcceptOfferAction } from '@/hooks/useAcceptOfferAction'
import { useCancelOfferAction } from '@/hooks/useCancelOfferAction'
import { useClaimPrincipalAction } from '@/hooks/useClaimPrincipalAction'
import { useLenderVaultClaimAction } from '@/hooks/useLenderVaultClaimAction'
import { useLiquidateOfferAction } from '@/hooks/useLiquidateOfferAction'
import type { PerformOfferAction } from '@/hooks/useOfferDeploymentAction'
import { useRepayOfferAction } from '@/hooks/useRepayOfferAction'
import { appKit } from '@/lib/humid/appkit'
import { type FakeInjectedProvider } from '@/lib/wallet/humid/fakeProvider'
import { WALLET_NAMESPACE } from '@/lib/wallet/network'
import { TxProgressProvider } from '@/providers/txProgress/TxProgressProvider'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { WalletFacadeProvider } from '@/providers/walletFacade/WalletFacadeProvider'
import { installFakeExtension } from '@/test/appkitEnvironment'

/**
 * Acting on an offer that already exists, as the wallet is asked for it.
 *
 * A person chooses nothing here: every value was fixed when the offer was created, and the
 * actions that follow declare no parameters. What this gathers is the deployment as the indexer
 * publishes it. What is proved is the joining — the recorded fields under the names the document
 * gives them, the two covenants these actions spend, and no covenant hash sent from a page that
 * cannot compute one.
 *
 * Accepting and cancelling are checked together because they send the same request under two
 * names: what separates them is the branch of the covenant that runs, which the document states.
 */

vi.mock('@/lib/wallet/lwk', () => ({
  scriptPubkeyFromDescriptor: (descriptor: string) => Promise.resolve(`script:${descriptor}`),
}))

const OFFER_TXID = 'ef'.repeat(32)
const FACTORY_ASSET = 'ab'.repeat(32)
const BORROWER_NFT = 'ba'.repeat(32)
const LENDER_NFT = 'bc'.repeat(32)
const COLLATERAL_ASSET = '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49'
const PRINCIPAL_ASSET = '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5'

vi.mock('@/api/indexer/methods', () => ({
  fetchFactory: () => Promise.resolve({ factory_asset_id: FACTORY_ASSET }),
  fetchOffer: () =>
    Promise.resolve({
      borrower_nft_asset: BORROWER_NFT,
      collateral_amount: 30_000n,
      collateral_asset: COLLATERAL_ASSET,
      interest_rate: 500,
      issuance_factory_id: 'factory-1',
      lender_nft_asset: LENDER_NFT,
      loan_expiration_height: 2_580_091,
      participants: [
        { participant_type: 'borrower', spent_txid: null, txid: OFFER_TXID, vout: 2 },
        { participant_type: 'lender', spent_txid: null, txid: OFFER_TXID, vout: 3 },
      ],
      principal_amount: 2_000n,
      principal_asset: PRINCIPAL_ASSET,
      protocol_fee_keeper_asset: PRINCIPAL_ASSET,
      status: 'pending',
      utxos: [{ spent_txid: null, txid: OFFER_TXID, utxo_type: 'pending_offer', vout: 5 }],
    }),
}))

const ACTIONS: [string, () => PerformOfferAction][] = [
  ['AcceptOffer', useAcceptOfferAction],
  ['CancelOffer', useCancelOfferAction],
  ['ClaimPrincipal', useClaimPrincipalAction],
  ['LiquidateOffer', useLiquidateOfferAction],
  ['RepayLoan', useRepayOfferAction],
  ['ClaimLenderVault', useLenderVaultClaimAction],
]

function Probe({ useAction }: { useAction: () => PerformOfferAction }) {
  const wallet = useWallet()
  const performOfferAction = useAction()
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
          performOfferAction('3')
            .then(result => {
              setOutcome(`sent: ${result.txid}`)
            })
            .catch((error: Error) => {
              setOutcome(`refused: ${error.message}`)
            })
        }}
      >
        act on offer
      </button>
    </div>
  )
}

function renderProbe(useAction: () => PerformOfferAction) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={queryClient}>
      <TxProgressProvider>
        <WalletFacadeProvider>
          <Probe useAction={useAction} />
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

async function sentRequest(useAction: () => PerformOfferAction) {
  wallet.performsAction({ broadcast: true, feeSats: '600', transactionHex: '02', txid: 'acc1' })
  renderProbe(useAction)
  await press('connect')
  await press('act on offer')

  await waitFor(() => {
    expect(wallet.actionRequests).toHaveLength(1)
  })

  return wallet.actionRequests[0] as {
    action: string
    instance: { instance: { fields: Record<string, string> } }
    params: Record<string, string>
    state: { utxos: { txid: string; utxo_type: string; vout: number }[] }
  }
}

describe.each(ACTIONS)('%s', (action, useAction) => {
  it('sends the deployment the offer was recorded with, and asks for nothing of a person', async () => {
    const request = await sentRequest(useAction)

    expect(request.action).toBe(action)
    expect(request.params).toEqual({})
    expect(request.instance.instance.fields).toEqual({
      BORROWER_NFT_ASSET_ID: BORROWER_NFT,
      COLLATERAL_AMOUNT: '30000',
      COLLATERAL_ASSET_ID: COLLATERAL_ASSET,
      FACTORY_ASSET_ID: FACTORY_ASSET,
      LENDER_NFT_ASSET_ID: LENDER_NFT,
      LOAN_EXPIRATION_TIME: '2580091',
      PRINCIPAL_AMOUNT: '2000',
      PRINCIPAL_ASSET_ID: PRINCIPAL_ASSET,
      PRINCIPAL_INTEREST_RATE: '500',
      PROTOCOL_FEE_KEEPER_ASSET_ID: PRINCIPAL_ASSET,
    })
  })

  it("locates every covenant the offer still holds, under the document's own type names", async () => {
    const request = await sentRequest(useAction)

    expect(request.state.utxos).toEqual([
      { txid: OFFER_TXID, utxo_type: 'lending_collateral', vout: 5 },
      { txid: OFFER_TXID, utxo_type: 'lender_nft_script_auth', vout: 3 },
    ])
  })

  it('reports the transaction the wallet sent', async () => {
    wallet.performsAction({ broadcast: true, feeSats: '600', transactionHex: '02', txid: 'acc1' })
    renderProbe(useAction)
    await press('connect')
    await press('act on offer')

    await waitFor(() => {
      expect(screen.getByTestId('outcome').textContent).toBe('sent: acc1')
    })
  })
})
