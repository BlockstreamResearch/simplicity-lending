import type { OfferDetails } from '@/api/indexer/schemas'

export const toOutpoint = (entry: { txid: string; vout: number }) => `${entry.txid}:${entry.vout}`

export function resolveNftOutpoints(offer: OfferDetails): {
  lenderNft: string
  borrowerNft: string
} | null {
  const lender = offer.participants.find(p => p.participant_type === 'lender')
  const borrower = offer.participants.find(p => p.participant_type === 'borrower')
  if (!lender || !borrower) return null
  return {
    lenderNft: toOutpoint(lender),
    borrowerNft: toOutpoint(borrower),
  }
}

export function resolvePendingOutpoint(offer: OfferDetails): string | null {
  const utxo = offer.utxos.find(u => u.utxo_type === 'pending_offer')
  return utxo ? toOutpoint(utxo) : null
}

export function resolveActiveOutpoint(offer: OfferDetails): string | null {
  const utxo = offer.utxos.find(u => u.utxo_type === 'active_offer')
  return utxo ? toOutpoint(utxo) : null
}

export function resolveRepaymentOutpoint(offer: OfferDetails): string | null {
  const utxo = offer.utxos.find(u => u.utxo_type === 'repayment')
  return utxo ? toOutpoint(utxo) : null
}

export function resolveLenderNftOutpoint(offer: OfferDetails): string | null {
  const lender = offer.participants.find(p => p.participant_type === 'lender')
  return lender ? toOutpoint(lender) : null
}

export function resolveBorrowerNftOutpoint(offer: OfferDetails): string | null {
  const borrower = offer.participants.find(p => p.participant_type === 'borrower')
  return borrower ? toOutpoint(borrower) : null
}
