/**
 * Parse broadcast API errors and format user-facing messages.
 * Handles "min relay fee not met, current < min" by suggesting rounded-up fee and rebuild.
 */

const MIN_RELAY_FEE_RE = /min relay fee not met,?\s*(\d+)\s*<\s*(\d+)/i

export function parseMinRelayFeeError(message: string): { current: number; min: number } | null {
  const m = message.match(MIN_RELAY_FEE_RE)
  if (!m) return null
  const current = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (Number.isNaN(current) || Number.isNaN(min)) return null
  return { current, min }
}

export function roundUpToMultipleOf5(n: number): number {
  if (n <= 0) return n
  return Math.ceil(n / 5) * 5
}

/**
 * Returns a user-friendly message for broadcast errors.
 * For "min relay fee not met, X < Y" returns a message with rounded min fee and rebuild hint.
 * Otherwise returns the raw message.
 */
export function formatBroadcastError(rawMessage: string): string {
  const parsed = parseMinRelayFeeError(rawMessage)
  if (!parsed) return rawMessage
  const suggested = roundUpToMultipleOf5(parsed.min)
  return `Fee is too low. Set fee to at least ${suggested} sats and rebuild the transaction.`
}
