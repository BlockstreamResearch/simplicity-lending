import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { liquidateOfferBuilder } from '@/protocol/actions/liquidateOffer'

export type { LiquidateOfferParams, LiquidateOfferSummary } from '@/protocol/actions/liquidateOffer'
export { liquidateOfferBuilder } from '@/protocol/actions/liquidateOffer'

/**
 * Liquidating a position, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useLiquidateOffer() {
  return liquidateOfferBuilder(useProtocolBuilderAccess())
}
