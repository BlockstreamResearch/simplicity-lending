import { z as zod } from 'zod'

export const liquidPricesResponseSchema = zod.object({
  count: zod.number(),
  currency: zod.string(),
  data: zod.record(zod.string(), zod.string()),
})
export type LiquidPricesResponse = zod.infer<typeof liquidPricesResponseSchema>

export type AssetPricesUsd = Record<string, number>
