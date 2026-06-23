const MINUTES_PER_BLOCK = 1 // Liquid ~1 min/block
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440
const GROUP_LOCALE = 'en-US'

function formatDecimalParts(whole: bigint, frac: string, negative = false): string {
  const wholeStr = whole.toLocaleString(GROUP_LOCALE)
  const fracStr = frac.replace(/0+$/, '')
  const out = fracStr ? `${wholeStr}.${fracStr}` : wholeStr
  return negative ? `-${out}` : out
}

// satoshis → grouped decimal string, trailing zeros trimmed.
export function formatAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base

  return formatDecimalParts(whole, frac.toString().padStart(decimals, '0'), negative)
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

// satoshis + USD price per unit → "$1,234.56", or null if price isn't available.
export function formatUsd(
  amount: bigint,
  decimals: number,
  priceUsd: number | null | undefined,
): string | null {
  if (priceUsd === null || priceUsd === undefined) return null
  const value = (Number(amount) / 10 ** decimals) * priceUsd
  if (!Number.isFinite(value)) return null

  const negative = value < 0
  const [whole = '0', frac = ''] = Math.abs(value).toFixed(2).split('.')
  const formatted = formatDecimalParts(BigInt(whole), frac)
  return negative ? `-$${formatted}` : `$${formatted}`
}
