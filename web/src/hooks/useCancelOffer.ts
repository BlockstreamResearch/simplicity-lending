import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { cancelOfferBuilder } from '@/protocol/actions/cancelOffer'

export type { CancelOfferParams, CancelOfferSummary } from '@/protocol/actions/cancelOffer'
export { cancelOfferBuilder } from '@/protocol/actions/cancelOffer'

/**
 * Cancelling an offer, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useCancelOffer() {
  return cancelOfferBuilder(useProtocolBuilderAccess())
}
