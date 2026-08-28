import { useState } from 'react'

import { fetchOffer } from '@/api/indexer/methods'
import type { OfferDetails } from '@/api/indexer/schemas'
import * as resolvers from '@/api/indexer/utils'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { useWallet } from '@/providers/wallet/useWallet'
import { resolveActorRole } from '@/utils/offerActions'

function jsonDump(value: unknown): string {
  return JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val), 2)
}

const RESOLVERS: Record<string, (offer: OfferDetails) => unknown> = {
  resolveNftOutpoints: resolvers.resolveNftOutpoints,
  resolvePendingOutpoint: resolvers.resolvePendingOutpoint,
  resolveActiveOutpoint: resolvers.resolveActiveOutpoint,
  resolveLenderVaultOutpoint: resolvers.resolveLenderVaultOutpoint,
  resolveActiveLenderVaultOutpoint: resolvers.resolveActiveLenderVaultOutpoint,
  resolveActiveProtocolFeeVaultOutpoint: resolvers.resolveActiveProtocolFeeVaultOutpoint,
  resolveLenderNftOutpoint: resolvers.resolveLenderNftOutpoint,
  resolveBorrowerNftOutpoint: resolvers.resolveBorrowerNftOutpoint,
  resolveBorrowerPrincipalOutpoint: resolvers.resolveBorrowerPrincipalOutpoint,
  resolveProtocolFeeVaultOutpoint: resolvers.resolveProtocolFeeVaultOutpoint,
}

interface Section {
  title: string
  value: unknown
}

function buildSections(offer: OfferDetails): Section[] {
  return [
    {
      title: 'Offer stats',
      value: {
        id: offer.id,
        status: offer.status,
        issuance_factory_id: offer.issuance_factory_id,
        collateral_asset: offer.collateral_asset,
        principal_asset: offer.principal_asset,
        collateral_amount: offer.collateral_amount,
        principal_amount: offer.principal_amount,
        current_debt: offer.current_debt,
        collateral_remaining: offer.collateral_remaining,
        interest_rate: offer.interest_rate,
        loan_expiration_height: offer.loan_expiration_height,
        created_at_height: offer.created_at_height,
        created_at_txid: offer.created_at_txid,
        borrower_nft_asset: offer.borrower_nft_asset,
        lender_nft_asset: offer.lender_nft_asset,
        protocol_fee_keeper_asset: offer.protocol_fee_keeper_asset,
        borrower_principal_utxo: offer.borrower_principal_utxo ?? null,
      },
    },
    { title: 'Vaults', value: offer.vaults },
    { title: 'Participants', value: offer.participants },
    { title: 'Utxos (lifecycle)', value: offer.utxos },
    { title: 'Repayments', value: offer.repayments },
    { title: 'Withdrawals', value: offer.withdrawals },
  ]
}

export default function OfferInspectorDemo() {
  const { scriptPubkey } = useWallet()
  const [offerId, setOfferId] = useState('')
  const [offer, setOffer] = useState<OfferDetails | null>(null)
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  })

  const handleResolve = async () => {
    setState({ busy: true, error: null })
    try {
      const result = await fetchOffer(offerId.trim())
      setOffer(result)
      setState({ busy: false, error: null })
    } catch (err) {
      setOffer(null)
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const role = offer ? resolveActorRole(offer, scriptPubkey) : null

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Offer Inspector</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Dumps the full indexer response for one offer, plus what every resolver in
        api/indexer/utils.ts currently resolves it to. Read-only — no transaction building.
      </p>

      <div className='mt-4 flex flex-wrap items-end gap-2'>
        <UiTextField label='Offer id' placeholder='e.g. 1' value={offerId} onChange={setOfferId} />
        <UiButton
          variant='outline'
          isDisabled={!offerId.trim()}
          isPending={state.busy}
          loadingText='Loading...'
          onPress={() => void handleResolve()}
        >
          Resolve
        </UiButton>
      </div>

      {state.error ? <p className='mt-2 text-xs text-red-500'>Resolve: {state.error}</p> : null}

      {offer ? (
        <div className='mt-4 flex flex-col gap-3'>
          <div className='rounded border border-gray-200 p-3 text-sm'>
            <span className='font-semibold'>Your role: </span>
            {role ?? 'unknown'}
            <span className='ml-2 text-xs text-gray-500'>
              (connected wallet scriptPubkey vs offer.participants)
            </span>
          </div>

          {buildSections(offer).map(section => (
            <div key={section.title} className='rounded border border-gray-200 p-3'>
              <div className='font-semibold'>{section.title}</div>
              <pre className='mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs'>
                {jsonDump(section.value)}
              </pre>
            </div>
          ))}

          <div className='rounded border border-gray-200 p-3'>
            <div className='font-semibold'>Resolved outpoints (api/indexer/utils.ts)</div>
            <pre className='mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs'>
              {jsonDump(
                Object.fromEntries(
                  Object.entries(RESOLVERS).map(([name, resolve]) => [name, resolve(offer)]),
                ),
              )}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
