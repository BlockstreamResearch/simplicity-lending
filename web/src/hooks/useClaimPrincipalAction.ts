import { type PerformOfferAction, useOfferDeploymentAction } from '@/hooks/useOfferDeploymentAction'

/**
 * Claims the loan principal: the borrower spends the covenant it was locked in, presenting the
 * borrower NFT and handing it straight back, and the principal reaches their wallet.
 */
export function useClaimPrincipalAction(): PerformOfferAction {
  return useOfferDeploymentAction('ClaimPrincipal')
}
