import { type PerformOfferAction, useOfferDeploymentAction } from '@/hooks/useOfferDeploymentAction'

/**
 * Repays a loan in full: the borrower clears the whole debt in one transaction, the borrower
 * NFT is burned so no further action on the offer is possible, and the collateral comes back.
 */
export function useRepayOfferAction(): PerformOfferAction {
  return useOfferDeploymentAction('RepayLoan')
}
