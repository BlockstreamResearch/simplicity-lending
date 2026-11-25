import type { AssetAmount, OfferShort } from '@/api/indexer/schemas'
import { BLOCKS_PER_DAY, BLOCKS_PER_YEAR } from '@/constants/blocks'
import {
  BPS_DIVISOR,
  HIGH_RISK_LTV,
  MAX_LTV,
  MAX_LTV_BAR_POSITION,
  MEDIUM_RISK_LTV,
  PROTOCOL_FEE_BPS,
} from '@/constants/offers'

import { formatTermLeft } from './format'
import { normalizeHex } from './hex'

export function calcInterest(principal: bigint, bps: number): bigint {
  return (principal * BigInt(Math.round(bps))) / BPS_DIVISOR
}

export function getTotalToRepay(offer: OfferShort): bigint {
  return offer.principal_amount + calcInterest(offer.principal_amount, offer.interest_rate)
}

export function computeProtocolFee(feeBaseUnits: bigint): bigint {
  return (feeBaseUnits * BigInt(PROTOCOL_FEE_BPS)) / BPS_DIVISOR
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function daysToBlocks(days: number): number {
  return days * BLOCKS_PER_DAY
}

export function feeToBps(feeBaseUnits: bigint, principalBaseUnits: bigint): number {
  if (principalBaseUnits <= 0n) return 0
  return Number((feeBaseUnits * BPS_DIVISOR) / principalBaseUnits)
}

export function computeApr(bps: number, loanDurationBlocks: number): number {
  if (loanDurationBlocks <= 0) return 0
  return (bps / Number(BPS_DIVISOR)) * (BLOCKS_PER_YEAR / loanDurationBlocks) * 100
}

export function computeAprAfterFees(bps: number, loanDurationBlocks: number): number {
  const lenderShareBps = Number(BPS_DIVISOR) - PROTOCOL_FEE_BPS
  return computeApr((bps * lenderShareBps) / Number(BPS_DIVISOR), loanDurationBlocks)
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

export type LoanRiskLevel = 'low' | 'medium' | 'high' | 'veryHigh' | 'critical'

export function getLoanRiskLevel(ltv: number): LoanRiskLevel {
  if (ltv >= 1) return 'critical'
  if (ltv > MAX_LTV) return 'veryHigh'
  if (ltv >= HIGH_RISK_LTV) return 'high'
  if (ltv >= MEDIUM_RISK_LTV) return 'medium'
  return 'low'
}

export function getLtvBarPosition(ltv: number): number {
  if (ltv >= 1) return 100
  if (ltv <= MAX_LTV) return (ltv / MAX_LTV) * MAX_LTV_BAR_POSITION
  return MAX_LTV_BAR_POSITION + ((ltv - MAX_LTV) / (1 - MAX_LTV)) * (100 - MAX_LTV_BAR_POSITION)
}

export function getLtvThresholdPrice({
  debt,
  debtDecimals,
  collateral,
  collateralDecimals,
  ltv,
}: {
  debt: bigint
  debtDecimals: number
  collateral: bigint
  collateralDecimals: number
  ltv: number
}): number | null {
  if (collateral <= 0n) return null
  const debtValue = Number(debt) / 10 ** debtDecimals
  const collateralValue = Number(collateral) / 10 ** collateralDecimals
  return debtValue / (ltv * collateralValue)
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
