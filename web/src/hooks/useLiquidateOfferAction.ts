import { type PerformOfferAction, useOfferDeploymentAction } from '@/hooks/useOfferDeploymentAction'

/**
 * Liquidates a defaulted position: past the loan's expiration height the lender burns the
 * lender NFT and takes the collateral, without the borrower being involved.
 */
export function useLiquidateOfferAction(): PerformOfferAction {
  return useOfferDeploymentAction('LiquidateOffer')
}
