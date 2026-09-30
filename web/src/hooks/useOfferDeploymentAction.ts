import { useCallback } from 'react'

import { fetchFactory, fetchOffer } from '@/api/indexer/methods'
import { useProtocolAction } from '@/hooks/useProtocolAction'
import type { WalletActionOutcome } from '@/lib/wallet/actionResult'
import { offerCovenants, offerDeploymentInput } from '@/protocol/offerDeployment'

const NO_COVENANTS = 'This offer has no covenant output left for an action to spend.'

export type PerformOfferAction = (offerId: string) => Promise<WalletActionOutcome>

/**
 * Performs one action on an offer that already exists, by asking the wallet to.
 *
 * A person chooses nothing: every value was fixed when the offer was created, and the actions
 * that follow declare no parameters. What this gathers is the deployment as it was recorded —
 * the indexer publishes it — and where its two covenants sit. Which branch of the covenant runs,
 * who is paid, what the fee is and where each input and output lands are all the wallet's,
 * worked out from the document.
 */
export function useOfferDeploymentAction(action: string): PerformOfferAction {
  const performProtocolAction = useProtocolAction()

  return useCallback(
    async (offerId: string) => {
      const offer = await fetchOffer(offerId)
      const covenants = offerCovenants(offer)

      if (covenants.length === 0) throw new Error(NO_COVENANTS)

      // The factory asset is a field of the deployment and the offer names only the factory it
      // was minted from, so it is read where it is published rather than carried around.
      const factory = await fetchFactory(offer.issuance_factory_id)

      const { instance, state } = offerDeploymentInput({
        borrowerNftAssetId: offer.borrower_nft_asset,
        collateralAmount: offer.collateral_amount,
        collateralAssetId: offer.collateral_asset,
        covenants,
        factoryAssetId: factory.factory_asset_id,
        lenderNftAssetId: offer.lender_nft_asset,
        loanExpirationHeight: offer.loan_expiration_height,
        principalAmount: offer.principal_amount,
        principalAssetId: offer.principal_asset,
        principalInterestRateBps: offer.interest_rate,
        protocolFeeKeeperAssetId: offer.protocol_fee_keeper_asset,
      })

      return performProtocolAction({ action, instance, state })
    },
    [action, performProtocolAction],
  )
}
