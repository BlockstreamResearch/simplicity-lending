import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OfferShort } from '../types/offers'
import { OfferTable } from './OfferTable'

const OFFER: OfferShort = {
  id: 'offer-1',
  status: 'active',
  collateral_asset: 'a'.repeat(64),
  principal_asset: 'b'.repeat(64),
  collateral_amount: 100n,
  principal_amount: 500n,
  interest_rate: 300,
  loan_expiration_time: 2407000,
  created_at_height: 2406000n,
  created_at_txid: 'c'.repeat(64),
}

describe('OfferTable', () => {
  it('renders row actions when provided', () => {
    const html = renderToStaticMarkup(
      <OfferTable
        offers={[OFFER]}
        loading={false}
        error={null}
        currentBlockHeight={2406900}
        renderActions={(offer) => <a href={`/borrower?offer=${offer.id}`}>Repay</a>}
      />
    )

    expect(html).toContain('Action')
    expect(html).toContain('Repay')
    expect(html).toContain('/borrower?offer=offer-1')
  })
})
