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

export type OfferWarningSeverity = 'danger' | 'warning'

export interface OfferInteraction {
  action: OfferAction
  severity: OfferWarningSeverity | null
  message: string | null
}

const DETAILS_ONLY: OfferInteraction = { action: 'none', severity: null, message: null }

function isOfferExpired(offer: OfferShort, currentBlockHeight: number): boolean {
  return currentBlockHeight > offer.loan_expiration_height
}

function resolveLenderInteraction(offer: OfferShort, expired: boolean): OfferInteraction {
  switch (offer.status) {
    case 'pending':
      return expired
        ? {
            action: 'none',
            severity: null,
            message: 'This offer has expired and can no longer be accepted.',
          }
        : { action: 'accept', severity: null, message: null }
    case 'active':
      return expired
        ? {
            action: 'liquidate',
            severity: 'danger',
            message: 'Loan expired. You can liquidate the collateral.',
          }
        : DETAILS_ONLY
    case 'repaid':
      return {
        action: 'claim-interest',
        severity: 'warning',
        message: 'Claim your loan repayment.',
      }
    default:
      return DETAILS_ONLY
  }
}

function resolveBorrowerInteraction(offer: OfferShort, expired: boolean): OfferInteraction {
  switch (offer.status) {
    case 'pending':
      return expired
        ? {
            action: 'cancel',
            severity: 'danger',
            message: 'Offer expired. Cancel to reclaim your collateral.',
          }
        : { action: 'cancel', severity: null, message: null }
    case 'active':
      return offer.borrower_principal_utxo
        ? { action: 'claim-principal', severity: 'warning', message: 'Claim your loan principal.' }
        : { action: 'repay', severity: null, message: null }
    default:
      return DETAILS_ONLY
  }
}

export function resolveOfferInteraction(
  offer: OfferShort,
  walletScriptPubkey: string | null,
  currentBlockHeight: number,
): OfferInteraction {
  const actorRole = resolveActorRole(offer, walletScriptPubkey)
  const expired = isOfferExpired(offer, currentBlockHeight)

  switch (actorRole) {
    case 'lender':
      return resolveLenderInteraction(offer, expired)
    case 'borrower':
      return resolveBorrowerInteraction(offer, expired)
    case 'guest':
      return DETAILS_ONLY
  }
}
