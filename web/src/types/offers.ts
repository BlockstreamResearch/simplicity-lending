/** Offer status from indexer API (lowercase) */
export type OfferStatus = 'pending' | 'active' | 'repaid' | 'liquidated' | 'cancelled' | 'claimed'

/** Participant role from indexer API (lowercase) */
export type ParticipantType = 'borrower' | 'lender'

/** Participant from POST /offers/batch response (participants array item). */
export interface ParticipantDto {
  offer_id: string
  participant_type: ParticipantType
  script_pubkey: string
}

/**
 * Short offer item from GET /offers.
 * Amounts and height are bigint to preserve u64 range (Number is safe only up to 2^53-1).
 */
export interface OfferShort {
  id: string
  status: OfferStatus
  collateral_asset: string
  principal_asset: string
  collateral_amount: bigint
  principal_amount: bigint
  interest_rate: number
  loan_expiration_time: number
  created_at_height: bigint
  created_at_txid: string
}

/** Offer with participants (from POST /offers/batch). */
export interface OfferWithParticipants extends OfferShort {
  participants: ParticipantDto[]
}
