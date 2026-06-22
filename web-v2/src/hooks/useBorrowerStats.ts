import { useCallback } from 'react'

import { useBorrowerOverview } from '@/api/indexer/hooks'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'
import { findAssetAmount } from '@/utils/offers'

export interface BorrowerStats {
  lockedCollateral: bigint
  borrowings: bigint
  activeLoans: number
  pendingOffers: number
}

export interface UseBorrowerStatsResult {
  stats: BorrowerStats
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useBorrowerStats(): UseBorrowerStatsResult {
  const { scriptPubkey } = useWallet()
  const query = useBorrowerOverview(scriptPubkey ?? '')

  const overview = query.data

  const refetch = useCallback(() => {
    query.refetch()
  }, [query])

  return {
    stats: {
      lockedCollateral: overview
        ? findAssetAmount(overview.collateral_locked, NETWORK_CONFIG.collateralAsset.id)
        : 0n,
      borrowings: overview
        ? findAssetAmount(overview.borrowings, NETWORK_CONFIG.principalAsset.id)
        : 0n,
      activeLoans: overview?.active_loans ?? 0,
      pendingOffers: overview?.pending_offers ?? 0,
    },
    isLoading: query.isLoading,
    error: query.error,
    refetch,
  }
}
