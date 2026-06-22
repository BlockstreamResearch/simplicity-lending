import { z } from 'zod'

import { blockHeightSchema, finiteNumber, u64AsBigint } from '@/utils/zod'

export const offerStatusSchema = z.enum([
  'pending',
  'active',
  'repaid',
  'liquidated',
  'cancelled',
  'claimed',
])
export type OfferStatus = z.infer<typeof offerStatusSchema>

export const participantTypeSchema = z.enum(['borrower', 'lender'])
export type ParticipantType = z.infer<typeof participantTypeSchema>

export const offerUtxoTypeSchema = z.enum([
  'pending_offer',
  'active_offer',
  'borrower_principal',
  'cancellation',
  'repayment',
  'liquidation',
  'claim',
])
export type OfferUtxoType = z.infer<typeof offerUtxoTypeSchema>

export const participantShortSchema = z.object({
  participant_type: participantTypeSchema,
  script_pubkey: z.string(),
})
export type ParticipantShort = z.infer<typeof participantShortSchema>

export const offerOutpointShortSchema = z.object({
  txid: z.string(),
  vout: z.coerce.number(),
})
export type OfferOutpointShort = z.infer<typeof offerOutpointShortSchema>

export const offerShortSchema = z.object({
  id: z.string(),
  issuance_factory_id: z.string(),
  status: offerStatusSchema,
  collateral_asset: z.string(),
  principal_asset: z.string(),
  collateral_amount: u64AsBigint,
  principal_amount: u64AsBigint,
  interest_rate: finiteNumber.default(0),
  loan_expiration_height: finiteNumber.default(0),
  created_at_height: blockHeightSchema,
  created_at_txid: z.string(),
  participants: z.array(participantShortSchema).default([]),
  borrower_principal_utxo: offerOutpointShortSchema.optional(),
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

export const offersOverviewSchema = z.object({
  collateral_locked: z.array(assetAmountSchema),
  active_loan_principal: z.array(assetAmountSchema),
  active_loans_count: z.coerce.number(),
})
export type OffersOverview = z.infer<typeof offersOverviewSchema>

export const borrowerOverviewSchema = z.object({
  collateral_locked: z.array(assetAmountSchema),
  borrowings: z.array(assetAmountSchema),
  active_loans: z.coerce.number(),
  pending_offers: z.coerce.number(),
})
export type BorrowerOverview = z.infer<typeof borrowerOverviewSchema>

export const lenderOverviewSchema = z.object({
  supplied_loans: z.array(assetAmountSchema),
  interest_outstanding: z.array(assetAmountSchema),
  active_loans: z.coerce.number(),
  to_be_claimed: z.coerce.number(),
})
export type LenderOverview = z.infer<typeof lenderOverviewSchema>

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
