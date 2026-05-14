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

export const u64AsBigint = z.preprocess(coerceToBigint, z.bigint())

export const blockHeightSchema = z.preprocess(
  coerceToNumber,
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
)

export const finiteNumber = z.coerce.number().refine(Number.isFinite, 'must be finite')
