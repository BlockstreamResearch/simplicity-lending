import { useMemo } from 'react'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLenderStats } from '@/hooks/useLenderStats'
import { formatAmount, formatUsd } from '@/utils/format'

export default function SupplyOverview() {
  const { stats, isLoading } = useLenderStats()
  const { principalAsset } = NETWORK_CONFIG
  const principalPriceUsd = useAssetPriceUsd(principalAsset.id)

  const tiles = useMemo<OverviewTile[]>(
    () => [
      {
        label: 'Supplied Loans',
        value: formatAmount(stats.suppliedLoans, principalAsset.decimals),
        usdValue: formatUsd(stats.suppliedLoans, principalAsset.decimals, principalPriceUsd),
        asset: principalAsset,
      },
      {
        label: 'Interest Outstanding',
        value: formatAmount(stats.interestOutstanding, principalAsset.decimals),
        usdValue: formatUsd(stats.interestOutstanding, principalAsset.decimals, principalPriceUsd),
        asset: principalAsset,
      },
      { label: 'Active Loans', value: String(stats.activeLoans) },
      { label: 'To be Claimed', value: String(stats.repaidToClaim) },
    ],
    [stats, principalAsset, principalPriceUsd],
  )

  return <UserOverview tiles={tiles} isLoading={isLoading} />
}
