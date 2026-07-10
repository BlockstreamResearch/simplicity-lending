import { ErrorHandler } from '@/utils/errorHandler'

import { fetchFeeEstimates, fetchTx } from './methods'

// lwk_wollet's TxBuilder.feeRate() takes sat/kvb, not sat/vb — see the doc comment on
// lwk_wollet::TxBuilder::fee_rate ("Multiply sats/vb value by 1000").
const SAT_PER_VB_TO_SAT_PER_KVB = 1000

const DEFAULT_TARGET_BLOCKS = 1

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

// BIP-125 rule 4: a replacement must pay extra fee of at least its OWN vsize × the node's min
// relay fee (a flat, absolute sat amount — not a percentage). A multiplier alone can't guarantee
// that: if the tx it's replacing already paid a tiny fee, "1.5x tiny" is still tiny. A flat
// sat/vB buffer fixes this — since minrelayfee is normally ~1 sat/vB, any buffer safely above
// that clears rule 4 regardless of vsize, because the extra scales with vsize the same way the
// requirement does. Padded well above the typical ~1 sat/vB floor for margin.
const REPLACEMENT_FEE_RATE_BUMP_SAT_PER_VB = 10

async function fetchTxFeeRateSatPerKvb(txid: string): Promise<number | null> {
  try {
    const tx = await fetchTx(txid)
    if (!tx.fee || !tx.weight) return null
    const vsize = Math.ceil(tx.weight / 4)
    return (tx.fee / vsize) * SAT_PER_VB_TO_SAT_PER_KVB
  } catch (error) {
    ErrorHandler.processWithoutFeedback(error)
    return null
  }
}

// Fee rate for a new tx that may end up conflicting with the wallet's own still-unconfirmed
// txids (e.g. a retry after one got stuck) — floors the live estimate so it always clears
// whatever those already paid, instead of risking an equal/lower rate that can't replace them.
export async function fetchFeeRateSatPerKvbAbovePending(
  pendingTxids: string[],
  targetBlocks: number = DEFAULT_TARGET_BLOCKS,
): Promise<number> {
  const [baseline, pendingFeeRates] = await Promise.all([
    fetchFeeRateSatPerKvb(targetBlocks),
    Promise.all(pendingTxids.map(fetchTxFeeRateSatPerKvb)),
  ])
  const maxPendingFeeRate = Math.max(
    0,
    ...pendingFeeRates.filter((rate): rate is number => rate !== null),
  )
  if (maxPendingFeeRate === 0) return baseline
  const bumped =
    maxPendingFeeRate + REPLACEMENT_FEE_RATE_BUMP_SAT_PER_VB * SAT_PER_VB_TO_SAT_PER_KVB
  return Math.max(baseline, Math.ceil(bumped))
}
