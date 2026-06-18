import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { formatAmount } from '@/utils/format'
import { bpsToPercent } from '@/utils/offers'

export default function BorrowOverview() {
  const { stats, isLoading } = useBorrowerStats()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  const tiles: OverviewTile[] = [
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
    { label: 'Average APR', value: bpsToPercent(stats.averageApr) },
    { label: 'Active Loans', value: String(stats.activeLoans) },
    { label: 'Pending Offers', value: String(stats.pendingOffers) },
  ]

  return (
    <UserOverview
      tiles={tiles}
      isLoading={isLoading}
      gridClassName='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6'
    />
  )
}
