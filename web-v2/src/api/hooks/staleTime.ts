export const STALE_TIME_MS = {
  immutable: Infinity,
  long: 5 * 60_000,
  medium: 60_000,
  short: 30_000,
  realtime: 10_000,
  tip: 15_000,
} as const

export const GC_TIME_MS = {
  default: 5 * 60_000,
  long: 30 * 60_000,
  immutable: Infinity,
} as const
