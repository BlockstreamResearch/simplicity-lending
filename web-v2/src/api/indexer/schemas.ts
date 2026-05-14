import { z } from 'zod'

import { ErrorHandler } from '@/utils/errorHandler'
import { blockHeightSchema, finiteNumber, u64AsBigint } from '@/utils/zod'

export const offerStatusSchema = z.enum([
  'pending',
  'active',
  'repaid',
  'liquidated',
  'cancelled',
  'claimed',
  'unknown',
])
export type OfferStatus = z.infer<typeof offerStatusSchema>

const offerStatusWithFallback = offerStatusSchema.catch(ctx => {
  ErrorHandler.processWithoutFeedback(
    new Error(`[api] unrecognized offer status: ${String(ctx.input)}`),
  )
  return 'unknown'
})

export const participantTypeSchema = z.enum(['borrower', 'lender'])
export type ParticipantType = z.infer<typeof participantTypeSchema>

export const offerUtxoTypeSchema = z.enum([
  'pre_lock',
  'lending',
  'cancellation',
  'repayment',
  'liquidation',
  'claim',
])
export type OfferUtxoType = z.infer<typeof offerUtxoTypeSchema>

export const offerShortSchema = z.object({
  id: z.string(),
  status: offerStatusWithFallback,
  collateral_asset: z.string(),
  principal_asset: z.string(),
  collateral_amount: u64AsBigint,
  principal_amount: u64AsBigint,
  interest_rate: finiteNumber.default(0),
  loan_expiration_time: finiteNumber.default(0),
  created_at_height: blockHeightSchema,
  created_at_txid: z.string(),
})
export type OfferShort = z.infer<typeof offerShortSchema>

export const offerFullSchema = offerShortSchema.extend({
  borrower_pubkey: z.string(),
  borrower_output_script_hash: z.string(),
  first_parameters_nft_asset: z.string(),
  second_parameters_nft_asset: z.string(),
  borrower_nft_asset: z.string(),
  lender_nft_asset: z.string(),
})
export type OfferFull = z.infer<typeof offerFullSchema>

export const participantDtoSchema = z.object({
  offer_id: z.string(),
  participant_type: participantTypeSchema,
  script_pubkey: z.string(),
})
export type ParticipantDto = z.infer<typeof participantDtoSchema>

export const offerDetailsSchema = offerFullSchema.extend({
  participants: z.array(participantDtoSchema).default([]),
})
export type OfferDetails = z.infer<typeof offerDetailsSchema>

export const offerUtxoSchema = z.object({
  offer_id: z.string(),
  txid: z.string(),
  vout: z.coerce.number(),
  utxo_type: offerUtxoTypeSchema,
  created_at_height: blockHeightSchema,
  spent_txid: z.string().nullable(),
  spent_at_height: z.coerce.number().nullable(),
})
export type OfferUtxo = z.infer<typeof offerUtxoSchema>

export const offerParticipantSchema = z.object({
  offer_id: z.string(),
  participant_type: participantTypeSchema,
  script_pubkey: z.string(),
  txid: z.string(),
  vout: z.coerce.number(),
  created_at_height: blockHeightSchema,
  spent_txid: z.string().nullable(),
  spent_at_height: z.coerce.number().nullable(),
})
export type OfferParticipant = z.infer<typeof offerParticipantSchema>

export const offerIdListSchema = z.array(z.string())

export const offerShortListSchema = z.array(offerShortSchema)
export const offerFullListSchema = z.array(offerFullSchema)
export const offerDetailsListSchema = z.array(offerDetailsSchema)
export const offerUtxoListSchema = z.array(offerUtxoSchema)
export const offerParticipantListSchema = z.array(offerParticipantSchema)
