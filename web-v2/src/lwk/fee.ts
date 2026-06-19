import { fetchFeeEstimates } from '@/api/esplora/methods'
import { ErrorHandler } from '@/utils/errorHandler'

// lwk_wollet's TxBuilder.feeRate() takes sat/kvb, not sat/vb — see the doc comment on
// lwk_wollet::TxBuilder::fee_rate ("Multiply sats/vb value by 1000").
const SAT_PER_VB_TO_SAT_PER_KVB = 1000

const DEFAULT_TARGET_BLOCKS = 2

export const FALLBACK_FEE_RATE_SAT_PER_KVB = 100

export async function fetchFeeRateSatPerKvb(
  targetBlocks: number = DEFAULT_TARGET_BLOCKS,
): Promise<number> {
  try {
    const estimates = await fetchFeeEstimates()
    const satPerVb = estimates[String(targetBlocks)] ?? estimates['1']
    if (!satPerVb) return FALLBACK_FEE_RATE_SAT_PER_KVB
    return satPerVb * SAT_PER_VB_TO_SAT_PER_KVB
  } catch (error) {
    ErrorHandler.processWithoutFeedback(error)
    return FALLBACK_FEE_RATE_SAT_PER_KVB
  }
}
