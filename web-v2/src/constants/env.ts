import { z } from 'zod'

const envSchema = z.object({
  VITE_API_URL: z.string().url().default('http://localhost:80'),
  DEV: z.boolean().default(false),
  PROD: z.boolean().default(false),
  VITE_ESPLORA_BASE_URL: z.string().url().default('https://blockstream.info/liquid/api'),
  VITE_NETWORK: z.enum(['liquid', 'liquidtestnet', 'regtest']).default('liquid'),
  VITE_WATERFALLS_URL: z.string().url(),
  VITE_WATERFALLS_RECIPIENT: z
    .string()
    .default('age1xxzrgrfjm3yrwh3u6a7exgrldked0pdauvr3mx870wl6xzrwm5ps8s2h0p'),
  VITE_DEBUG_MNEMONIC: z.string().optional().default(''),
})

export const env = envSchema.parse({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_ESPLORA_BASE_URL: import.meta.env.VITE_ESPLORA_BASE_URL,
  VITE_NETWORK: import.meta.env.VITE_NETWORK,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD,
  VITE_WATERFALLS_URL: import.meta.env.VITE_WATERFALLS_URL,
  VITE_WATERFALLS_RECIPIENT: import.meta.env.VITE_WATERFALLS_RECIPIENT,
  VITE_DEBUG_MNEMONIC: import.meta.env.VITE_DEBUG_MNEMONIC,
})

export type AppEnv = z.infer<typeof envSchema>

export type NetworkName = AppEnv['VITE_NETWORK']
