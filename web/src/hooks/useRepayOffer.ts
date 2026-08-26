import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { repayOfferBuilder } from '@/protocol/actions/repayOffer'

export type { RepayOfferParams, RepayOfferSummary } from '@/protocol/actions/repayOffer'
export { repayOfferBuilder } from '@/protocol/actions/repayOffer'

/**
 * Repaying a loan, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useRepayOffer() {
  return repayOfferBuilder(useProtocolBuilderAccess())
}
