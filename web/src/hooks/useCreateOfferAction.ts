import { useCallback } from 'react'

import { fetchLatestBlockHeight } from '@/api/esplora/methods'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerFactory } from '@/hooks/useBorrowerFactory'
import { useProtocolAction } from '@/hooks/useProtocolAction'
import type { WalletActionOutcome } from '@/lib/wallet/actionResult'
import { type ChosenOffer, offerRequestInput } from '@/protocol/createOffer'

const NO_FACTORY = 'No active factory found. Create a borrower account first.'

/**
 * Creates a lending offer by asking the wallet to perform the protocol's own action.
 *
 * Four numbers come from the person; the asset ids come from this deployment's configuration;
 * the factory comes from the indexer; the tip comes from the chain. Which outputs pay for it,
 * where each input and output lands, and what every covenant address is are all the wallet's,
 * worked out from the document.
 */
export function useCreateOfferAction(): (chosen: ChosenOffer) => Promise<WalletActionOutcome> {
  const performProtocolAction = useProtocolAction()
  const { factoryState } = useBorrowerFactory()

  return useCallback(
    async (chosen: ChosenOffer) => {
      if (!factoryState) throw new Error(NO_FACTORY)

      // Read at the moment the offer is made: an expiration height worked out from a tip the
      // page loaded with shortens the loan by however long the page has been open.
      const tipHeight = await fetchLatestBlockHeight()

      const { params, state } = offerRequestInput({
        assets: {
          collateralAssetId: NETWORK_CONFIG.collateralAsset.id,
          principalAssetId: NETWORK_CONFIG.principalAsset.id,
          protocolFeeKeeperAssetId: NETWORK_CONFIG.protocolFeeAsset.id,
        },
        chosen,
        factory: factoryState,
        tipHeight,
      })

      return performProtocolAction({ action: 'CreateOffer', params, state })
    },
    [factoryState, performProtocolAction],
  )
}

export type { ChosenOffer }
