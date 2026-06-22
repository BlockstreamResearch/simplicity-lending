import type { OfferShort } from '@/api/indexer/schemas'

import { normalizeHex } from './hex'

export type ActorRole = 'lender' | 'borrower' | 'guest'

export function resolveActorRole(offer: OfferShort, walletScriptPubkey: string | null): ActorRole {
  if (!walletScriptPubkey) return 'guest'
  const mine = normalizeHex(walletScriptPubkey)
  const match = offer.participants.find(p => normalizeHex(p.script_pubkey) === mine)
  if (match) return match.participant_type
  if (offer.status === 'pending') return 'lender'
  return 'guest'
}

export type OfferAction =
  | 'accept'
  | 'cancel'
  | 'repay'
  | 'claim-principal'
  | 'claim-interest'
  | 'liquidate'
  | 'none'

function isOfferExpired(offer: OfferShort, currentBlockHeight: number): boolean {
  return currentBlockHeight > offer.loan_expiration_height
}

function resolveLenderAction(offer: OfferShort, expired: boolean): OfferAction {
  switch (offer.status) {
    case 'pending':
      return expired ? 'none' : 'accept'
    case 'active':
      return expired ? 'liquidate' : 'none'
    case 'repaid':
      return 'claim-interest'
    default:
      return 'none'
  }
}

function resolveBorrowerAction(offer: OfferShort): OfferAction {
  switch (offer.status) {
    case 'pending':
      return 'cancel'
    case 'active':
      return offer.borrower_principal_utxo ? 'claim-principal' : 'repay'
    default:
      return 'none'
  }
}

export function resolveOfferAction(
  offer: OfferShort,
  walletScriptPubkey: string | null,
  currentBlockHeight: number,
): OfferAction {
  const role = resolveActorRole(offer, walletScriptPubkey)
  const expired = isOfferExpired(offer, currentBlockHeight)

  switch (role) {
    case 'lender':
      return resolveLenderAction(offer, expired)
    case 'borrower':
      return resolveBorrowerAction(offer)
    case 'guest':
      return 'none'
  }
}
