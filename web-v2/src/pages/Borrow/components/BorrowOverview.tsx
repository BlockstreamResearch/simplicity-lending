import { useMemo } from 'react'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { formatAmount, formatUsd } from '@/utils/format'

export default function BorrowOverview() {
  const { stats, isLoading } = useBorrowerStats()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const principalPriceUsd = useAssetPriceUsd(principalAsset.id)

  const tiles = useMemo<OverviewTile[]>(
    () => [
      {
        label: 'Collateral Locked',
        value: formatAmount(stats.lockedCollateral, collateralAsset.decimals),
        usdValue: formatUsd(stats.lockedCollateral, collateralAsset.decimals, collateralPriceUsd),
        asset: collateralAsset,
      },
      {
        label: 'Borrowings',
        value: formatAmount(stats.borrowings, principalAsset.decimals),
        usdValue: formatUsd(stats.borrowings, principalAsset.decimals, principalPriceUsd),
        asset: principalAsset,
      },
      // TODO: show real value once /borrowers/overview returns an average APR (backend doesn't expose it yet).
      { label: 'Average APR', value: '—' },
      { label: 'Active Loans', value: String(stats.activeLoans) },
      { label: 'Pending Offers', value: String(stats.pendingOffers) },
    ],
    [stats, collateralAsset, principalAsset, collateralPriceUsd, principalPriceUsd],
  )

  return (
    <UserOverview
      tiles={tiles}
      isLoading={isLoading}
      gridClassName='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6'
    />
  )
}
