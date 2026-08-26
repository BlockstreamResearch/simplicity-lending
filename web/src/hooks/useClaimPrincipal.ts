import { useProtocolBuilderAccess } from '@/hooks/useProtocolBuilderAccess'
import { claimPrincipalBuilder } from '@/protocol/actions/claimPrincipal'

export type { ClaimPrincipalParams, ClaimPrincipalSummary } from '@/protocol/actions/claimPrincipal'
export { claimPrincipalBuilder } from '@/protocol/actions/claimPrincipal'

/**
 * Claiming the principal, over the wallet the person connected.
 *
 * The builder itself lives beside the protocol it builds for, because a wallet that signs in this
 * page calls it too and neither side is the narrower home. This is the screen's way in.
 */
export function useClaimPrincipal() {
  return claimPrincipalBuilder(useProtocolBuilderAccess())
}
