import type { OfferDetails, OfferVault } from '@/api/indexer/schemas'
import { VAULT_MIN_REMAINDER } from '@/constants/offers'

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
  const utxo = offer.utxos.find(u => u.utxo_type === 'active_offer' && u.spent_txid === null)
  return utxo ? toOutpoint(utxo) : null
}

export function findFinalizedLenderVault(offer: OfferDetails): OfferVault | null {
  return offer.vaults.find(v => v.vault_type === 'lender' && v.is_finalized) ?? null
}

export function resolveLenderVaultOutpoint(offer: OfferDetails): string | null {
  const vault = findFinalizedLenderVault(offer)
  return vault ? toOutpoint(vault) : null
}

export function findActiveLenderVault(offer: OfferDetails): OfferVault | null {
  return offer.vaults.find(v => v.vault_type === 'lender' && !v.is_finalized) ?? null
}

export function getActiveLenderVaultBalance(offer: OfferDetails): bigint {
  return findActiveLenderVault(offer)?.amount ?? 0n
}

export function getWithdrawableAmount(offer: OfferDetails): bigint {
  const balance = getActiveLenderVaultBalance(offer)
  return balance > VAULT_MIN_REMAINDER ? balance - VAULT_MIN_REMAINDER : 0n
}

export function resolveActiveLenderVaultOutpoint(offer: OfferDetails): string | null {
  const vault = findActiveLenderVault(offer)
  return vault ? toOutpoint(vault) : null
}

export function resolveActiveProtocolFeeVaultOutpoint(offer: OfferDetails): string | null {
  const vault = offer.vaults.find(v => v.vault_type === 'protocol_fee' && !v.is_finalized)
  return vault ? toOutpoint(vault) : null
}

export function resolveLenderNftOutpoint(offer: OfferDetails): string | null {
  const lender = offer.participants.find(p => p.participant_type === 'lender')
  return lender ? toOutpoint(lender) : null
}

export function resolveBorrowerNftOutpoint(offer: OfferDetails): string | null {
  const borrower = offer.participants.find(p => p.participant_type === 'borrower')
  return borrower ? toOutpoint(borrower) : null
}

export function resolveBorrowerPrincipalOutpoint(offer: OfferDetails): string | null {
  return offer.borrower_principal_utxo ? toOutpoint(offer.borrower_principal_utxo) : null
}

export function resolveProtocolFeeVaultOutpoint(offer: OfferDetails): string | null {
  const vault = offer.vaults.find(v => v.vault_type === 'protocol_fee' && v.is_finalized)
  return vault ? toOutpoint(vault) : null
}
