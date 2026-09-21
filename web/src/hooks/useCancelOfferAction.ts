import { type PerformOfferAction, useOfferDeploymentAction } from '@/hooks/useOfferDeploymentAction'

/**
 * Cancels an offer nobody accepted: both NFTs are burned and the collateral returns to the
 * borrower, without the counterparty being involved at all.
 */
export function useCancelOfferAction(): PerformOfferAction {
  return useOfferDeploymentAction('CancelOffer')
}
