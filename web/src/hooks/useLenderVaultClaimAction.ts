import { type PerformOfferAction, useOfferDeploymentAction } from '@/hooks/useOfferDeploymentAction'

/**
 * Collects a settlement from the lender vault: after a loan is repaid in full, the lender
 * spends the finalized vault with their NFT, burns it and takes the balance.
 */
export function useLenderVaultClaimAction(): PerformOfferAction {
  return useOfferDeploymentAction('ClaimLenderVault')
}
