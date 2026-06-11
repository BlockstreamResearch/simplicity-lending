import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form'
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

export function createZodResolver<TValues extends FieldValues, TContext = unknown>(
  schema: z.ZodType<TValues> | ((context: TContext) => z.ZodType),
): Resolver<TValues, TContext> {
  return async (values, context) => {
    const resolved = typeof schema === 'function' ? schema(context as TContext) : schema
    const result = resolved.safeParse(values)
    if (result.success) return { values: result.data as TValues, errors: {} }
    if (import.meta.env.DEV) {
      const dropped = result.error.issues.filter(
        issue => issue.path.length === 0 || typeof issue.path[0] !== 'string',
      )
      if (dropped.length > 0) {
        console.error(
          'createZodResolver: dropping non-string-path errors (array field schema?)',
          dropped,
        )
      }
    }
    return {
      values: {},
      errors: Object.fromEntries(
        result.error.issues
          .filter(issue => issue.path.length > 0 && typeof issue.path[0] === 'string')
          .map(issue => [issue.path[0], { type: issue.code, message: issue.message }]),
      ) as FieldErrors<TValues>,
    }
  }
}
