const MINUTES_PER_BLOCK = 1 // Liquid ~1 min/block
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440

// satoshis → grouped decimal string, trailing zeros trimmed.
export function formatAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base

  const wholeStr = whole.toLocaleString('en-US')
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')

  const out = fracStr ? `${wholeStr}.${fracStr}` : wholeStr
  return negative ? `-${out}` : out
}

// blocks remaining → "Expired" / "~Xm" / "~Xh" / ">Xd".
export function formatTermLeft(blocksLeft: number): string {
  if (blocksLeft <= 0) return 'Expired'
  const minutes = blocksLeft * MINUTES_PER_BLOCK
  if (minutes < MINUTES_PER_HOUR) return `~${minutes}m`
  if (minutes < MINUTES_PER_DAY) return `~${Math.round(minutes / MINUTES_PER_HOUR)}h`
  return `>${Math.floor(minutes / MINUTES_PER_DAY)}d`
}

export function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export const DECIMAL_AMOUNT_RE = /^\d+(\.\d+)?$/
