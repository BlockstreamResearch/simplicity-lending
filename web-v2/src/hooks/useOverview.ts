import { useMemo } from 'react'

import { useOffersOverview } from '@/api/indexer/hooks'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { findAssetAmount } from '@/utils/offers'

export interface DashboardOverview {
  totalCollateral: bigint
  totalActiveLoans: bigint
  activeLoansCount: number
}

export function useOverview({ pollIntervalMs = 30_000 }: { pollIntervalMs?: number } = {}) {
  const overviewQuery = useOffersOverview({ refetchInterval: pollIntervalMs })

  const overview = useMemo<DashboardOverview>(() => {
    const data = overviewQuery.data
    return {
      totalCollateral: data
        ? findAssetAmount(data.collateral_locked, NETWORK_CONFIG.collateralAsset.id)
        : 0n,
      totalActiveLoans: data
        ? findAssetAmount(data.active_loan_principal, NETWORK_CONFIG.principalAsset.id)
        : 0n,
      activeLoansCount: data?.active_loans_count ?? 0,
    }
  }, [overviewQuery.data])

  return { overview, isLoading: overviewQuery.isLoading }
}
