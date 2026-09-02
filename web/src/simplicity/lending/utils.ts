import { BPS_DIVISOR } from '@/constants/offers'
import { toUint64, type Uint16, type Uint64 } from '@/utils/uint'

interface TotalAmountToRepayParams {
  principalAmount: Uint64
  principalInterestRate: Uint16
}

export function getTotalAmountToRepay(params: TotalAmountToRepayParams): Uint64 {
  return toUint64(
    params.principalAmount +
      (params.principalAmount * BigInt(params.principalInterestRate)) / BPS_DIVISOR,
    'totalAmountToRepay',
  )
}

export function getTotalFee(params: TotalAmountToRepayParams): Uint64 {
  return toUint64(
    (params.principalAmount * BigInt(params.principalInterestRate)) / BPS_DIVISOR,
    'totalFee',
  )
}

// 10% of the total fee goes to the protocol, matching PROTOCOL_FEE_PERCENTAGE in Rust.
// Check crates/contracts/src/programs/lending/offer.rs
const PROTOCOL_FEE_BPS = 1_000n

export function getProtocolFee(feeAmount: Uint64): Uint64 {
  return toUint64((feeAmount * PROTOCOL_FEE_BPS) / BPS_DIVISOR, 'protocolFee')
}

interface CollateralForPrincipalParams extends TotalAmountToRepayParams {
  collateralAmount: Uint64
}

export function getCollateralForPrincipal(
  params: CollateralForPrincipalParams,
  principalAmount: Uint64,
): Uint64 {
  return toUint64(
    (principalAmount * params.collateralAmount) / getTotalAmountToRepay(params),
    'collateralForPrincipal',
  )
}

export function getAlreadyUnlockedCollateral(
  params: CollateralForPrincipalParams,
  currentDebt: Uint64,
): Uint64 {
  const alreadyRepaidAmount = toUint64(
    getTotalAmountToRepay(params) - currentDebt,
    'alreadyRepaidAmount',
  )
  return getCollateralForPrincipal(params, alreadyRepaidAmount)
}

export type OfferRepaymentPhase =
  | 'NoRepayments'
  | 'RepayingOfferFee'
  | 'RepayingPrincipal'
  | 'Repaid'

export function getRepaymentPhase(
  params: TotalAmountToRepayParams,
  currentDebt: Uint64,
): OfferRepaymentPhase {
  const totalAmountToRepay = getTotalAmountToRepay(params)
  if (currentDebt >= totalAmountToRepay) return 'NoRepayments'
  if (currentDebt === 0n) return 'Repaid'

  const totalFee = getTotalFee(params)
  const repaidAmount = totalAmountToRepay - currentDebt

  return totalFee > repaidAmount ? 'RepayingOfferFee' : 'RepayingPrincipal'
}
