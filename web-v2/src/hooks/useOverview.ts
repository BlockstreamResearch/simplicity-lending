import { useMemo } from 'react'

import { useOffers } from '@/api/indexer/hooks'

export interface DashboardOverview {
  totalCollateral: bigint
  totalActiveLoans: bigint
  avgInterestRate: number
  activeLoansCount: number
}
// TODO: Stats should be computed server-side via a dedicated /stats endpoint (tracked in indexer README).
// Current approach fetches up to 100 active offers and aggregates client-side — rewrite this hook once the endpoint exists.
export function useOverview({ pollIntervalMs = 30_000 }: { pollIntervalMs?: number } = {}) {
  const offersQuery = useOffers(
    { status: 'active', limit: 100 },
    { refetchInterval: pollIntervalMs },
  )

  const overview = useMemo<DashboardOverview>(() => {
    const active = offersQuery.data?.items ?? []
    return {
      totalCollateral: active.reduce((acc, o) => acc + o.collateral_amount, 0n),
      totalActiveLoans: active.reduce((acc, o) => acc + o.principal_amount, 0n),
      avgInterestRate: active.length
        ? active.reduce((acc, o) => acc + o.interest_rate, 0) / active.length
        : 0,
      activeLoansCount: active.length,
    }
  }, [offersQuery.data])

  return { overview, isLoading: offersQuery.isLoading }
}
