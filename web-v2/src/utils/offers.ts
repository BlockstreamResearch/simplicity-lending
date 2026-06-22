import type { AssetAmount, OfferShort } from '@/api/indexer/schemas'

import { formatTermLeft } from './format'
import { normalizeHex } from './hex'

const BPS_DIVISOR = 10_000
const AVERAGE_BLOCK_TIME_SECONDS = 60
const BLOCKS_PER_DAY = (24 * 60 * 60) / AVERAGE_BLOCK_TIME_SECONDS
const BLOCKS_PER_YEAR = 365 * BLOCKS_PER_DAY

export function calcInterest(principal: bigint, bps: number): bigint {
  return (principal * BigInt(Math.round(bps))) / BigInt(BPS_DIVISOR)
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function daysToBlocks(days: number): number {
  return days * BLOCKS_PER_DAY
}

export function feeToBps(feeBaseUnits: bigint, principalBaseUnits: bigint): number {
  if (principalBaseUnits <= 0n) return 0
  return Number((feeBaseUnits * BigInt(BPS_DIVISOR)) / principalBaseUnits)
}

export function computeApr(bps: number, loanDurationBlocks: number): number {
  if (loanDurationBlocks <= 0) return 0
  return (bps / BPS_DIVISOR) * (BLOCKS_PER_YEAR / loanDurationBlocks) * 100
}

export function computeLtv({
  principal,
  principalDecimals,
  collateral,
  collateralDecimals,
  collateralUsd,
}: {
  principal: bigint
  principalDecimals: number
  collateral: bigint
  collateralDecimals: number
  collateralUsd: number | null
}): number | null {
  if (collateralUsd === null || collateral <= 0n) return null
  const principalValue = Number(principal) / 10 ** principalDecimals
  const collateralValue = (Number(collateral) / 10 ** collateralDecimals) * collateralUsd
  return principalValue / collateralValue
}

export function getOfferTermLeft(offer: OfferShort, currentBlockHeight: number): number {
  return offer.loan_expiration_height - currentBlockHeight
}

export function formatOfferTermLeft(offer: OfferShort, currentBlockHeight: number | null): string {
  if (!currentBlockHeight) return '–'
  return formatTermLeft(getOfferTermLeft(offer, currentBlockHeight))
}

export function findAssetAmount(amounts: AssetAmount[], assetId: string): bigint {
  return amounts.find(a => normalizeHex(a.asset) === normalizeHex(assetId))?.amount ?? 0n
}
