import { useBlockHeight, useBlockTimestamp } from '@/api/esplora/hooks'
import { AVERAGE_BLOCK_TIME_SECONDS } from '@/utils/offers'

const MS_PER_SECOND = 1_000

export function useBlockDate(blockHeight: number, minedAnchorHeight = blockHeight): Date | null {
  const { data: currentBlockHeight } = useBlockHeight()
  const anchorHeight = blockHeight <= currentBlockHeight ? blockHeight : minedAnchorHeight
  const { data: anchorTimestamp } = useBlockTimestamp(anchorHeight)

  if (anchorTimestamp === undefined) return null

  const blocksAfterAnchor = blockHeight - anchorHeight
  return new Date(
    (anchorTimestamp + blocksAfterAnchor * AVERAGE_BLOCK_TIME_SECONDS) * MS_PER_SECOND,
  )
}
