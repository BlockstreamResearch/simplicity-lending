import { z as zod } from 'zod'

const absoluteUrlOrPath = zod.string().refine(
  (value: string) => {
    if (value.startsWith('/')) return true
    return zod.string().url().safeParse(value).success
  },
  { message: 'must be an absolute URL or same-origin path' },
)

const envSchema = zod.object({
  VITE_API_URL: absoluteUrlOrPath.default('http://localhost:8000'),
  DEV: zod.boolean().default(false),
  PROD: zod.boolean().default(false),
  VITE_ESPLORA_BASE_URL: zod.string().url().default('https://blockstream.info/liquid'),
  VITE_NETWORK: zod.enum(['liquid', 'liquidtestnet', 'regtest']).default('liquid'),
  VITE_WATERFALLS_URL: zod.string().url(),
  VITE_WATERFALLS_RECIPIENT: zod
    .string()
    .default('age1xxzrgrfjm3yrwh3u6a7exgrldked0pdauvr3mx870wl6xzrwm5ps8s2h0p'),
  VITE_DEBUG_MNEMONIC: zod.string().optional().default(''),
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

export type AppEnv = zod.infer<typeof envSchema>

export type NetworkName = AppEnv['VITE_NETWORK']
