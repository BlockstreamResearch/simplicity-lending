import { useMemo } from 'react'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { formatAmount, formatUsd } from '@/utils/format'
import { formatPolicyAssetAmount } from '@/utils/policyAssetDenomination'

export default function BorrowOverview() {
  const { stats, isLoading } = useBorrowerStats()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { denomination } = useAssetDenomination()
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const principalPriceUsd = useAssetPriceUsd(principalAsset.id)

  const tiles = useMemo<OverviewTile[]>(
    () => [
      {
        label: 'Collateral Locked',
        value: formatPolicyAssetAmount(stats.lockedCollateral, denomination, collateralAsset),
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
    [stats, collateralAsset, principalAsset, collateralPriceUsd, principalPriceUsd, denomination],
  )

  return (
    <UserOverview
      tiles={tiles}
      isLoading={isLoading}
      gridClassName='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6'
    />
  )
}
