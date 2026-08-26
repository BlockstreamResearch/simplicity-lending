import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { lenderVaultClaimBuilder } from '@/protocol/actions/lenderVaultClaim'

export type {
  LenderVaultClaimParams,
  LenderVaultClaimSummary,
} from '@/protocol/actions/lenderVaultClaim'
export { lenderVaultClaimBuilder } from '@/protocol/actions/lenderVaultClaim'

/**
 * Collecting the lender settlement, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useLenderVaultClaim() {
  return lenderVaultClaimBuilder(useProtocolBuilderAccess())
}
