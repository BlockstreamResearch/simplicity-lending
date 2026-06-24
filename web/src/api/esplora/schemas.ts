import { z as zod } from 'zod'

export const txStatusSchema = zod.object({
  confirmed: zod.boolean(),
  block_height: zod.number().optional(),
  block_hash: zod.string().optional(),
  block_time: zod.number().optional(),
})
export type TxStatus = zod.infer<typeof txStatusSchema>

export const chainOrMempoolStatsSchema = zod
  .object({
    tx_count: zod.number(),
    funded_txo_count: zod.number(),
    funded_txo_sum: zod.number().optional(),
    spent_txo_count: zod.number(),
    spent_txo_sum: zod.number().optional(),
  })
  .passthrough()
export type ChainOrMempoolStats = zod.infer<typeof chainOrMempoolStatsSchema>

export const addressInfoSchema = zod
  .object({
    address: zod.string(),
    chain_stats: chainOrMempoolStatsSchema,
    mempool_stats: chainOrMempoolStatsSchema,
  })
  .passthrough()
export type AddressInfo = zod.infer<typeof addressInfoSchema>

export const scriptHashUtxoEntrySchema = zod
  .object({
    txid: zod.string(),
    vout: zod.number(),
    value: zod.number().optional(),
    valuecommitment: zod.string().optional(),
    asset: zod.string().optional(),
    assetcommitment: zod.string().optional(),
    nonce: zod.string().optional(),
    noncecommitment: zod.string().optional(),
    status: txStatusSchema,
  })
  .passthrough()
export type ScriptHashUtxoEntry = zod.infer<typeof scriptHashUtxoEntrySchema>

export const scriptHashTxEntrySchema = zod
  .object({
    txid: zod.string(),
    status: txStatusSchema,
  })
  .passthrough()
export type ScriptHashTxEntry = zod.infer<typeof scriptHashTxEntrySchema>

export const esploraVoutSchema = zod
  .object({
    scriptpubkey: zod.string().optional(),
    scriptpubkey_hex: zod.string().optional(),
    value: zod.number().optional(),
    asset: zod.string().optional(),
  })
  .passthrough()
export type EsploraVout = zod.infer<typeof esploraVoutSchema>

export const esploraVinSchema = zod
  .object({
    txid: zod.string().optional(),
    vout: zod.number().optional(),
    is_coinbase: zod.boolean().optional(),
  })
  .passthrough()
export type EsploraVin = zod.infer<typeof esploraVinSchema>

export const esploraTxSchema = zod
  .object({
    txid: zod.string(),
    vout: zod.array(esploraVoutSchema),
    vin: zod.array(esploraVinSchema).optional(),
    status: txStatusSchema.optional(),
  })
  .passthrough()
export type EsploraTx = zod.infer<typeof esploraTxSchema>

export const esploraOutspendSchema = zod
  .object({
    spent: zod.boolean(),
    txid: zod.string().optional(),
    vin: zod.number().optional(),
    status: txStatusSchema.optional(),
  })
  .passthrough()
export type EsploraOutspend = zod.infer<typeof esploraOutspendSchema>

export const txIdListSchema = zod.array(zod.string())
export const scriptHashUtxoListSchema = zod.array(scriptHashUtxoEntrySchema)
export const scriptHashTxListSchema = zod.array(scriptHashTxEntrySchema)
export const esploraOutspendListSchema = zod.array(esploraOutspendSchema)

export const blockHeightTextSchema = zod
  .string()
  .regex(/^\d+$/, 'block height must be a positive integer string')
  .transform(value => Number.parseInt(value, 10))

export const feeEstimatesSchema = zod.record(zod.string(), zod.number())
export type FeeEstimates = zod.infer<typeof feeEstimatesSchema>
