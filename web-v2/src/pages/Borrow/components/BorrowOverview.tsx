import { useMemo } from 'react'

import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { formatAmount } from '@/utils/format'

export default function BorrowOverview() {
  const { stats, isLoading } = useBorrowerStats()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  const tiles = useMemo<OverviewTile[]>(
    () => [
      {
        label: 'Collateral Locked',
        value: formatAmount(stats.lockedCollateral, collateralAsset.decimals),
        asset: collateralAsset,
      },
      {
        label: 'Borrowings',
        value: formatAmount(stats.borrowings, principalAsset.decimals),
        asset: principalAsset,
      },
      // TODO: show real value once /borrowers/overview returns an average APR (backend doesn't expose it yet).
      { label: 'Average APR', value: '—' },
      { label: 'Active Loans', value: String(stats.activeLoans) },
      { label: 'Pending Offers', value: String(stats.pendingOffers) },
    ],
    [stats, collateralAsset, principalAsset],
  )

  return (
    <UserOverview
      tiles={tiles}
      isLoading={isLoading}
      gridClassName='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6'
    />
  )
}
