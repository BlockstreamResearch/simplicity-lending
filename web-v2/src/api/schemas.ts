import { z } from 'zod'

function coerceToBigint(value: unknown): unknown {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'string') return BigInt(value)
  if (typeof value === 'number') return BigInt(Math.floor(value))
  return value
}

function coerceToNumber(value: unknown): unknown {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return value
}

const u64AsBigint = z.preprocess(coerceToBigint, z.bigint())
const u64AsNumber = z.preprocess(coerceToNumber, z.number())

const finiteNumber = z.coerce.number().refine(Number.isFinite, 'must be finite')

export const offerStatusSchema = z.enum([
  'pending',
  'active',
  'repaid',
  'liquidated',
  'cancelled',
  'claimed',
])
export type OfferStatus = z.infer<typeof offerStatusSchema>

const offerStatusWithFallback = offerStatusSchema.catch(ctx => {
  console.warn('[api] unknown offer status, falling back to "pending"', { value: ctx.input })
  return 'pending'
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
  created_at_height: u64AsNumber,
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
  created_at_height: u64AsNumber,
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
  created_at_height: u64AsNumber,
  spent_txid: z.string().nullable(),
  spent_at_height: z.coerce.number().nullable(),
})
export type OfferParticipant = z.infer<typeof offerParticipantSchema>

export const offerIdListSchema = z.array(z.string())

export const txStatusSchema = z.object({
  confirmed: z.boolean(),
  block_height: z.number().optional(),
  block_hash: z.string().optional(),
  block_time: z.number().optional(),
})
export type TxStatus = z.infer<typeof txStatusSchema>

export const chainOrMempoolStatsSchema = z
  .object({
    tx_count: z.number(),
    funded_txo_count: z.number(),
    funded_txo_sum: z.number().optional(),
    spent_txo_count: z.number(),
    spent_txo_sum: z.number().optional(),
  })
  .passthrough()
export type ChainOrMempoolStats = z.infer<typeof chainOrMempoolStatsSchema>

export const addressInfoSchema = z
  .object({
    address: z.string(),
    chain_stats: chainOrMempoolStatsSchema,
    mempool_stats: chainOrMempoolStatsSchema,
  })
  .passthrough()
export type AddressInfo = z.infer<typeof addressInfoSchema>

export const scripthashUtxoEntrySchema = z
  .object({
    txid: z.string(),
    vout: z.number(),
    value: z.number().optional(),
    valuecommitment: z.string().optional(),
    asset: z.string().optional(),
    assetcommitment: z.string().optional(),
    nonce: z.string().optional(),
    noncecommitment: z.string().optional(),
    status: txStatusSchema,
  })
  .passthrough()
export type ScripthashUtxoEntry = z.infer<typeof scripthashUtxoEntrySchema>

export const scripthashTxEntrySchema = z
  .object({
    txid: z.string(),
    status: txStatusSchema,
  })
  .passthrough()
export type ScripthashTxEntry = z.infer<typeof scripthashTxEntrySchema>

export const esploraVoutSchema = z
  .object({
    scriptpubkey: z.string().optional(),
    scriptpubkey_hex: z.string().optional(),
    value: z.number().optional(),
    asset: z.string().optional(),
  })
  .passthrough()
export type EsploraVout = z.infer<typeof esploraVoutSchema>

export const esploraTxSchema = z
  .object({
    txid: z.string(),
    vout: z.array(esploraVoutSchema),
    vin: z.array(z.unknown()).optional(),
    status: txStatusSchema.optional(),
  })
  .passthrough()
export type EsploraTx = z.infer<typeof esploraTxSchema>

export const esploraOutspendSchema = z
  .object({
    spent: z.boolean(),
    txid: z.string().optional(),
    vin: z.number().optional(),
    status: txStatusSchema.optional(),
  })
  .passthrough()
export type EsploraOutspend = z.infer<typeof esploraOutspendSchema>
