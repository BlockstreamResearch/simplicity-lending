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
  'pending_offer',
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
  issuance_factory_id: z.string(),
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
  borrower_nft_asset: z.string(),
  lender_nft_asset: z.string(),
  protocol_fee_keeper_asset: z.string(),
})
export type OfferFull = z.infer<typeof offerFullSchema>

export const participantDtoSchema = z.object({
  offer_id: z.string(),
  participant_type: participantTypeSchema,
  script_pubkey: z.string(),
  txid: z.string(),
  vout: z.coerce.number(),
  created_at_height: blockHeightSchema,
  spent_txid: z.string().nullable(),
  spent_at_height: z.coerce.number().nullable(),
})
export type ParticipantDto = z.infer<typeof participantDtoSchema>
export type OfferParticipant = ParticipantDto

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

export const offerDetailsSchema = offerFullSchema.extend({
  participants: z.array(participantDtoSchema).default([]),
  utxos: z.array(offerUtxoSchema).default([]),
})
export type OfferDetails = z.infer<typeof offerDetailsSchema>

export const offerIdListSchema = z.array(z.string())

export const offerListResponseSchema = z.object({
  items: z.array(offerShortSchema),
  total: z.coerce.number(),
  limit: z.coerce.number(),
  offset: z.coerce.number(),
})
export type OfferListResponse = z.infer<typeof offerListResponseSchema>

export const assetAmountSchema = z.object({
  asset: z.string(),
  amount: u64AsBigint,
})
export type AssetAmount = z.infer<typeof assetAmountSchema>

export const borrowerOverviewSchema = z.object({
  collateral_locked: z.array(assetAmountSchema),
  borrowings: z.array(assetAmountSchema),
  active_loans: z.coerce.number(),
  pending_offers: z.coerce.number(),
})
export type BorrowerOverview = z.infer<typeof borrowerOverviewSchema>

export const borrowerDashboardSchema = z.object({
  overview: borrowerOverviewSchema,
  offers: offerListResponseSchema,
})
export type BorrowerDashboard = z.infer<typeof borrowerDashboardSchema>

export const factoryStatusSchema = z.enum(['active', 'removed'])
export type FactoryStatus = z.infer<typeof factoryStatusSchema>

export const factoryAuthUtxoSchema = z.object({
  txid: z.string(),
  vout: z.coerce.number(),
  script_pubkey: z.string(),
  created_at_height: blockHeightSchema,
})
export type FactoryAuthUtxo = z.infer<typeof factoryAuthUtxoSchema>

export const factoryProgramUtxoSchema = z.object({
  txid: z.string(),
  vout: z.coerce.number(),
  created_at_height: blockHeightSchema,
})
export type FactoryProgramUtxo = z.infer<typeof factoryProgramUtxoSchema>

export const factoryDetailsSchema = z.object({
  id: z.string(),
  factory_asset_id: z.string(),
  program_script_pubkey: z.string(),
  status: factoryStatusSchema,
  issuing_utxos_count: z.coerce.number(),
  reissuance_flags: u64AsBigint,
  created_at_height: blockHeightSchema,
  created_at_txid: z.string(),
  auth_utxo: factoryAuthUtxoSchema.nullable(),
  program_utxo: factoryProgramUtxoSchema.nullable(),
})
export type FactoryDetails = z.infer<typeof factoryDetailsSchema>

export const factoryListSchema = z.array(factoryDetailsSchema)
