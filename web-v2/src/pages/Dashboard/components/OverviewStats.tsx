import { Skeleton } from '@heroui/react'
import { useMemo } from 'react'

import { type ConfigAsset, NETWORK_CONFIG } from '@/constants/network-config'
import { useOverview } from '@/hooks/useOverview'
import { formatAmount } from '@/utils/format'
import { bpsToPercent } from '@/utils/offers'

interface OverviewStat {
  label: string
  value: string
  asset?: ConfigAsset
}

export default function OverviewStats() {
  const { overview, isLoading } = useOverview()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  const stats = useMemo<OverviewStat[]>(
    () => [
      {
        label: 'Total Collateral Locked',
        value: formatAmount(overview.totalCollateral, collateralAsset.decimals),
        asset: collateralAsset,
      },
      {
        label: 'Total Active Loans',
        value: formatAmount(overview.totalActiveLoans, principalAsset.decimals),
        asset: principalAsset,
      },
      { label: 'Average Interest Rate', value: bpsToPercent(overview.avgInterestRate) },
      { label: 'Number of Active Loans', value: String(overview.activeLoansCount) },
    ],
    [overview, collateralAsset, principalAsset],
  )

  return (
    <div className='grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6'>
      {stats.map(stat => {
        const Icon = stat.asset?.icon
        return (
          <div
            key={stat.label}
            className='bg-surface-secondary flex flex-col gap-3 rounded-2xl p-6'
          >
            <h3 className='text-muted text-h4'>{stat.label}</h3>
            {isLoading ? (
              <Skeleton className='h-8 w-24 rounded-lg' />
            ) : (
              <div className='flex items-center justify-between gap-2'>
                <span className='text-display'>{stat.value}</span>
                {stat.asset && Icon && (
                  <span className='inline-flex items-center gap-1.5 text-sm font-medium'>
                    <Icon className='size-4' />
                    {stat.asset.symbol}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
