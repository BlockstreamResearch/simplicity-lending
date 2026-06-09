import { useMemo } from 'react'

import { useOffers } from '@/api/indexer/hooks'
import { DASHBOARD_REFETCH_INTERVAL_MS } from '@/constants/dashboard'

export interface DashboardOverview {
  totalCollateral: bigint
  totalActiveLoans: bigint
  avgInterestRate: number
  activeLoansCount: number
}

const EMPTY_OVERVIEW: DashboardOverview = {
  totalCollateral: 0n,
  totalActiveLoans: 0n,
  avgInterestRate: 0,
  activeLoansCount: 0,
}

export function useOverview() {
  const offersQuery = useOffers({}, { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS })

  // FIXME(backend): computed over one offers page, not all offers — totals are
  // approximate. Needs a server-side aggregate endpoint (GET /offers/stats).
  const overview = useMemo<DashboardOverview>(() => {
    const active = (offersQuery.data ?? []).filter(o => o.status === 'active')
    if (active.length === 0) return EMPTY_OVERVIEW
    return {
      totalCollateral: active.reduce((acc, o) => acc + o.collateral_amount, 0n),
      totalActiveLoans: active.reduce((acc, o) => acc + o.principal_amount, 0n),
      avgInterestRate: active.reduce((acc, o) => acc + o.interest_rate, 0) / active.length,
      activeLoansCount: active.length,
    }
  }, [offersQuery.data])

  return { overview, isLoading: offersQuery.isLoading }
}
