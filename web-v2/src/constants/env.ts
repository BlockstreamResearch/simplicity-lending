import { z } from 'zod'

const envSchema = z.object({
  VITE_API_URL: z.string().url().default('http://localhost:8000'),
  VITE_ESPLORA_BASE_URL: z.string().url().default('https://blockstream.info/liquidtestnet/api'),
  VITE_NETWORK: z.enum(['liquid', 'liquidtestnet', 'regtest']).default('liquidtestnet'),
})

export const env = envSchema.parse({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_ESPLORA_BASE_URL: import.meta.env.VITE_ESPLORA_BASE_URL,
  VITE_NETWORK: import.meta.env.VITE_NETWORK,
})

export type AppEnv = z.infer<typeof envSchema>
