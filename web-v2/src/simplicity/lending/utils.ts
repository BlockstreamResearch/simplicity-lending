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
