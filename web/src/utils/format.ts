import {
  AVERAGE_BLOCK_TIME_SECONDS,
  BLOCKS_PER_DAY,
  BLOCKS_PER_HOUR,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '@/constants/blocks'
import { NETWORK_CONFIG } from '@/constants/network-config'

import { hexToBytes } from './hex'
import { segwitV0ScriptPubkeyToAddress } from './segwitAddress'

export const DISPLAY_LOCALE = 'en-US'

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}
const SHORT_DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

function formatDecimalParts(whole: bigint, frac: string, negative = false): string {
  const wholeStr = whole.toLocaleString(DISPLAY_LOCALE)
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

export function formatAmountInput(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const frac = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? `${amount / base}.${frac}` : `${amount / base}`
}

export function formatFeeReserve(amountSats: bigint): string {
  return `${amountSats.toLocaleString(DISPLAY_LOCALE)} ${NETWORK_CONFIG.policyAssetSatsUnit}`
}

interface BlocksDuration {
  days: number
  hours: number
  minutes: number
}

const HALF_HOUR_MINUTES = MINUTES_PER_HOUR / 2

export function splitBlocksDuration(blocks: number): BlocksDuration {
  const safeBlocks = Math.max(0, blocks)
  return {
    days: Math.floor(safeBlocks / BLOCKS_PER_DAY),
    hours: Math.floor((safeBlocks % BLOCKS_PER_DAY) / BLOCKS_PER_HOUR),
    minutes: Math.floor(
      ((safeBlocks % BLOCKS_PER_HOUR) * AVERAGE_BLOCK_TIME_SECONDS) / SECONDS_PER_MINUTE,
    ),
  }
}

export function formatBlocksDuration(blocks: number): string {
  const { days, hours, minutes } = splitBlocksDuration(blocks)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function formatTermLeft(blocksLeft: number): string {
  if (blocksLeft <= 0) return 'Expired'
  const { days, hours, minutes } = splitBlocksDuration(blocksLeft)
  if (days > 0) return `>${days}d`
  if (hours > 0) return `~${minutes >= HALF_HOUR_MINUTES ? hours + 1 : hours}h`
  return `~${minutes}m`
}

export function truncateAddress(address: string): string {
  if (!address) return ''
  if (address.length <= 12) return address

  // If it's a long Liquid Confidential address, use a balanced layout
  if (address.length > 50) {
    return `${address.slice(0, 6)}...${address.slice(-6)}`
  }

  // Fallback for standard Bitcoin or Unconfidential Liquid addresses
  return `${address.slice(0, 8)}...${address.slice(-4)}`
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

export function formatDateTime(date: Date): string {
  return date.toLocaleString(DISPLAY_LOCALE, DATE_TIME_FORMAT)
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(DISPLAY_LOCALE, SHORT_DATE_FORMAT)
}

export function scriptPubkeyToAddress(scriptPubkeyHex: string): string {
  try {
    return segwitV0ScriptPubkeyToAddress(
      hexToBytes(scriptPubkeyHex),
      NETWORK_CONFIG.unconfidentialAddressHrp,
    )
  } catch {
    return scriptPubkeyHex
  }
}

export function formatScriptPubkeyAsAddress(scriptPubkeyHex: string): string {
  return truncateAddress(scriptPubkeyToAddress(scriptPubkeyHex))
}
