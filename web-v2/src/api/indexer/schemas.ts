import { z as zod } from 'zod'

import { blockHeightSchema, finiteNumber, u64AsBigint } from '@/utils/zod'

export const offerStatusSchema = zod.enum([
  'pending',
  'active',
  'repaid',
  'liquidated',
  'cancelled',
  'claimed',
])
export type OfferStatus = zod.infer<typeof offerStatusSchema>

export const participantTypeSchema = zod.enum(['borrower', 'lender'])
export type ParticipantType = zod.infer<typeof participantTypeSchema>

export const offerUtxoTypeSchema = zod.enum([
  'pending_offer',
  'active_offer',
  'borrower_principal',
  'cancellation',
  'repayment',
  'liquidation',
  'claim',
])
export type OfferUtxoType = zod.infer<typeof offerUtxoTypeSchema>

export const participantShortSchema = zod.object({
  participant_type: participantTypeSchema,
  script_pubkey: zod.string(),
})
export type ParticipantShort = zod.infer<typeof participantShortSchema>

export const offerOutpointShortSchema = zod.object({
  txid: zod.string(),
  vout: zod.coerce.number(),
})
export type OfferOutpointShort = zod.infer<typeof offerOutpointShortSchema>

export const offerShortSchema = zod.object({
  id: zod.string(),
  issuance_factory_id: zod.string(),
  status: offerStatusSchema,
  collateral_asset: zod.string(),
  principal_asset: zod.string(),
  collateral_amount: u64AsBigint,
  principal_amount: u64AsBigint,
  interest_rate: finiteNumber.default(0),
  loan_expiration_height: finiteNumber.default(0),
  created_at_height: blockHeightSchema,
  created_at_txid: zod.string(),
  participants: zod.array(participantShortSchema).default([]),
  borrower_principal_utxo: offerOutpointShortSchema.optional(),
})
export type OfferShort = zod.infer<typeof offerShortSchema>

export const offerFullSchema = offerShortSchema.extend({
  borrower_nft_asset: zod.string(),
  lender_nft_asset: zod.string(),
  protocol_fee_keeper_asset: zod.string(),
})
export type OfferFull = zod.infer<typeof offerFullSchema>

export const participantDtoSchema = zod.object({
  offer_id: zod.string(),
  participant_type: participantTypeSchema,
  script_pubkey: zod.string(),
  txid: zod.string(),
  vout: zod.coerce.number(),
  created_at_height: blockHeightSchema,
  spent_txid: zod.string().nullable(),
  spent_at_height: zod.coerce.number().nullable(),
})
export type ParticipantDto = zod.infer<typeof participantDtoSchema>

export const offerUtxoSchema = zod.object({
  offer_id: zod.string(),
  txid: zod.string(),
  vout: zod.coerce.number(),
  utxo_type: offerUtxoTypeSchema,
  created_at_height: blockHeightSchema,
  spent_txid: zod.string().nullable(),
  spent_at_height: zod.coerce.number().nullable(),
})
export type OfferUtxo = zod.infer<typeof offerUtxoSchema>

export const offerDetailsSchema = offerFullSchema.extend({
  participants: zod.array(participantDtoSchema).default([]),
  utxos: zod.array(offerUtxoSchema).default([]),
})
export type OfferDetails = zod.infer<typeof offerDetailsSchema>

export const offerListResponseSchema = zod.object({
  items: zod.array(offerShortSchema),
  total: zod.coerce.number(),
  limit: zod.coerce.number(),
  offset: zod.coerce.number(),
})
export type OfferListResponse = zod.infer<typeof offerListResponseSchema>

export const assetAmountSchema = zod.object({
  asset: zod.string(),
  amount: u64AsBigint,
})
export type AssetAmount = zod.infer<typeof assetAmountSchema>

export const offersOverviewSchema = zod.object({
  collateral_locked: zod.array(assetAmountSchema),
  active_loan_principal: zod.array(assetAmountSchema),
  active_loans_count: zod.coerce.number(),
})
export type OffersOverview = zod.infer<typeof offersOverviewSchema>

export const borrowerOverviewSchema = zod.object({
  collateral_locked: zod.array(assetAmountSchema),
  borrowings: zod.array(assetAmountSchema),
  active_loans: zod.coerce.number(),
  pending_offers: zod.coerce.number(),
})
export type BorrowerOverview = zod.infer<typeof borrowerOverviewSchema>

export const lenderOverviewSchema = zod.object({
  supplied_loans: zod.array(assetAmountSchema),
  interest_outstanding: zod.array(assetAmountSchema),
  active_loans: zod.coerce.number(),
  to_be_claimed: zod.coerce.number(),
})
export type LenderOverview = zod.infer<typeof lenderOverviewSchema>

export const factoryStatusSchema = zod.enum(['active', 'removed'])
export type FactoryStatus = zod.infer<typeof factoryStatusSchema>

export const factoryAuthUtxoSchema = zod.object({
  txid: zod.string(),
  vout: zod.coerce.number(),
  script_pubkey: zod.string(),
  created_at_height: blockHeightSchema,
})
export type FactoryAuthUtxo = zod.infer<typeof factoryAuthUtxoSchema>

export const factoryProgramUtxoSchema = zod.object({
  txid: zod.string(),
  vout: zod.coerce.number(),
  created_at_height: blockHeightSchema,
})
export type FactoryProgramUtxo = zod.infer<typeof factoryProgramUtxoSchema>

export const factoryDetailsSchema = zod.object({
  id: zod.string(),
  factory_asset_id: zod.string(),
  program_script_pubkey: zod.string(),
  status: factoryStatusSchema,
  issuing_utxos_count: zod.coerce.number(),
  reissuance_flags: u64AsBigint,
  created_at_height: blockHeightSchema,
  created_at_txid: zod.string(),
  auth_utxo: factoryAuthUtxoSchema.nullable(),
  program_utxo: factoryProgramUtxoSchema.nullable(),
})
export type FactoryDetails = zod.infer<typeof factoryDetailsSchema>

export const factoryListSchema = zod.array(factoryDetailsSchema)
