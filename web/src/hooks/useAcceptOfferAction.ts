import { type PerformOfferAction, useOfferDeploymentAction } from '@/hooks/useOfferDeploymentAction'

/**
 * Accepts a lending offer: the lender supplies the principal, the loan goes live and the lender
 * NFT comes back to them, all in the transaction the wallet builds from the document.
 */
export function useAcceptOfferAction(): PerformOfferAction {
  return useOfferDeploymentAction('AcceptOffer')
}
