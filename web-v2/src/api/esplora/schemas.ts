import { z } from 'zod'

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

export const scriptHashUtxoEntrySchema = z
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
export type ScriptHashUtxoEntry = z.infer<typeof scriptHashUtxoEntrySchema>

export const scriptHashTxEntrySchema = z
  .object({
    txid: z.string(),
    status: txStatusSchema,
  })
  .passthrough()
export type ScriptHashTxEntry = z.infer<typeof scriptHashTxEntrySchema>

export const esploraVoutSchema = z
  .object({
    scriptpubkey: z.string().optional(),
    scriptpubkey_hex: z.string().optional(),
    value: z.number().optional(),
    asset: z.string().optional(),
  })
  .passthrough()
export type EsploraVout = z.infer<typeof esploraVoutSchema>

export const esploraVinSchema = z
  .object({
    txid: z.string().optional(),
    vout: z.number().optional(),
    is_coinbase: z.boolean().optional(),
  })
  .passthrough()
export type EsploraVin = z.infer<typeof esploraVinSchema>

export const esploraTxSchema = z
  .object({
    txid: z.string(),
    vout: z.array(esploraVoutSchema),
    vin: z.array(esploraVinSchema).optional(),
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

export const txIdListSchema = z.array(z.string())
export const scriptHashUtxoListSchema = z.array(scriptHashUtxoEntrySchema)
export const scriptHashTxListSchema = z.array(scriptHashTxEntrySchema)
export const esploraOutspendListSchema = z.array(esploraOutspendSchema)

export const blockHeightTextSchema = z
  .string()
  .regex(/^\d+$/, 'block height must be a positive integer string')
  .transform(value => Number.parseInt(value, 10))
