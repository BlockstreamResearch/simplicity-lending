import type { OfferStatus } from '@/api/indexer/schemas'

export interface MockOffer {
  id: string
  collateral: number
  loanAmount: number
  earn: number
  apr: number
  termLeft: string
  status: OfferStatus
}

export const MOCK_OFFERS: MockOffer[] = [
  {
    id: '1',
    collateral: 0.01,
    loanAmount: 300,
    earn: 15,
    apr: 8.41,
    termLeft: '~2h',
    status: 'pending',
  },
  {
    id: '2',
    collateral: 0.05,
    loanAmount: 1500,
    earn: 62,
    apr: 7.2,
    termLeft: '~5h',
    status: 'pending',
  },
  {
    id: '3',
    collateral: 0.02,
    loanAmount: 600,
    earn: 28,
    apr: 8.9,
    termLeft: '~1d',
    status: 'active',
  },
  {
    id: '4',
    collateral: 0.008,
    loanAmount: 240,
    earn: 11,
    apr: 8.1,
    termLeft: '~3h',
    status: 'pending',
  },
  {
    id: '5',
    collateral: 0.03,
    loanAmount: 900,
    earn: 40,
    apr: 7.8,
    termLeft: '~12h',
    status: 'active',
  },
  {
    id: '6',
    collateral: 0.015,
    loanAmount: 450,
    earn: 19,
    apr: 8.3,
    termLeft: 'Expired',
    status: 'cancelled',
  },
  {
    id: '7',
    collateral: 0.04,
    loanAmount: 1200,
    earn: 50,
    apr: 7.5,
    termLeft: 'Expired',
    status: 'repaid',
  },
  {
    id: '8',
    collateral: 0.012,
    loanAmount: 360,
    earn: 16,
    apr: 8.6,
    termLeft: '~8h',
    status: 'pending',
  },
  {
    id: '9',
    collateral: 0.06,
    loanAmount: 1800,
    earn: 74,
    apr: 7.1,
    termLeft: 'Expired',
    status: 'liquidated',
  },
  {
    id: '10',
    collateral: 0.025,
    loanAmount: 750,
    earn: 33,
    apr: 8.0,
    termLeft: '~2d',
    status: 'active',
  },
  {
    id: '11',
    collateral: 0.009,
    loanAmount: 270,
    earn: 12,
    apr: 8.7,
    termLeft: 'Expired',
    status: 'claimed',
  },
  {
    id: '12',
    collateral: 0.018,
    loanAmount: 540,
    earn: 23,
    apr: 8.2,
    termLeft: '~6h',
    status: 'pending',
  },
  {
    id: '13',
    collateral: 0.035,
    loanAmount: 1050,
    earn: 44,
    apr: 7.6,
    termLeft: '~18h',
    status: 'active',
  },
  {
    id: '14',
    collateral: 0.007,
    loanAmount: 210,
    earn: 9.5,
    apr: 8.9,
    termLeft: 'Expired',
    status: 'repaid',
  },
]

// Nudges one random offer's numbers a little, so the preview feels alive
// without the data ever meaning anything real.
export function jitterOffers(offers: MockOffer[]): MockOffer[] {
  const index = Math.floor(Math.random() * offers.length)
  return offers.map((offer, i) => {
    if (i !== index) return offer
    const drift = 1 + (Math.random() - 0.5) * 0.08
    return {
      ...offer,
      loanAmount: Math.round(offer.loanAmount * drift),
      earn: Math.round(offer.earn * drift * 10) / 10,
      apr: Math.round(offer.apr * drift * 100) / 100,
    }
  })
}
