import { z } from 'zod'

export const liquidPricesResponseSchema = z.object({
  count: z.number(),
  currency: z.string(),
  data: z.record(z.string(), z.string()),
})
export type LiquidPricesResponse = z.infer<typeof liquidPricesResponseSchema>

export type AssetPricesUsd = Record<string, number>
