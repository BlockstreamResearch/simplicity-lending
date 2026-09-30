import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { acceptOfferBuilder } from '@/protocol/actions/acceptOffer'

export type { AcceptOfferParams, AcceptOfferSummary } from '@/protocol/actions/acceptOffer'
export { acceptOfferBuilder } from '@/protocol/actions/acceptOffer'

/**
 * Accepting one, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useAcceptOffer() {
  return acceptOfferBuilder(useProtocolBuilderAccess())
}
