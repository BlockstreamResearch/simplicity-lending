import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { createOfferBuilder } from '@/protocol/actions/createOffer'

export type { CreateOfferParams, CreateOfferSummary } from '@/protocol/actions/createOffer'
export { createOfferBuilder } from '@/protocol/actions/createOffer'

/**
 * Creating a lending offer, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useCreateOffer() {
  return createOfferBuilder(useProtocolBuilderAccess())
}
