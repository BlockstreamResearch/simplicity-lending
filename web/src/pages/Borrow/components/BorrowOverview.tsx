import { useMemo } from 'react'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { formatAmount, formatUsd } from '@/utils/format'

export default function BorrowOverview() {
  const { stats, isLoading } = useBorrowerStats()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { formatCollateralAmount } = useFormatAmount()
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const principalPriceUsd = useAssetPriceUsd(principalAsset.id)

  const tiles = useMemo<OverviewTile[]>(
    () => [
      {
        label: 'Collateral Locked',
        value: formatCollateralAmount(stats.lockedCollateral),
        usdValue: formatUsd(stats.lockedCollateral, collateralAsset.decimals, collateralPriceUsd),
        asset: collateralAsset,
      },
      {
        label: 'Borrowings',
        value: formatAmount(stats.borrowings, principalAsset.decimals),
        usdValue: formatUsd(stats.borrowings, principalAsset.decimals, principalPriceUsd),
        asset: principalAsset,
      },
      { label: 'Active Loans', value: String(stats.activeLoans) },
      { label: 'Pending Offers', value: String(stats.pendingOffers) },
    ],
    [
      stats,
      collateralAsset,
      principalAsset,
      collateralPriceUsd,
      principalPriceUsd,
      formatCollateralAmount,
    ],
  )

  return <UserOverview tiles={tiles} isLoading={isLoading} />
}
