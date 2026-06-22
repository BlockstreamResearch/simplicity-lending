import { useMemo } from 'react'

import UserOverview, { type OverviewTile } from '@/components/UserOverview'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLenderStats } from '@/hooks/useLenderStats'
import { formatAmount } from '@/utils/format'

export default function SupplyOverview() {
  const { stats, isLoading } = useLenderStats()
  const { principalAsset } = NETWORK_CONFIG

  const tiles = useMemo<OverviewTile[]>(
    () => [
      {
        label: 'Supplied Loans',
        value: formatAmount(stats.suppliedLoans, principalAsset.decimals),
        asset: principalAsset,
      },
      {
        label: 'Interest Outstanding',
        value: formatAmount(stats.interestOutstanding, principalAsset.decimals),
        asset: principalAsset,
      },
      { label: 'Active Loans', value: String(stats.activeLoans) },
      { label: 'To be Claimed', value: String(stats.repaidToClaim) },
    ],
    [stats, principalAsset],
  )

  return <UserOverview tiles={tiles} isLoading={isLoading} />
}
