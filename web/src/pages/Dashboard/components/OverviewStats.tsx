import { Skeleton } from '@heroui/react'
import { useMemo } from 'react'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import { type ConfigAsset, NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useOverview } from '@/hooks/useOverview'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { formatAmount, formatUsd } from '@/utils/format'
import { getAssetUnit } from '@/utils/policyAssetDenomination'

interface OverviewStat {
  label: string
  value: string
  usdValue?: string | null
  asset?: ConfigAsset
}

export default function OverviewStats() {
  const { overview, isLoading } = useOverview()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { denomination } = useAssetDenomination()
  const { formatCollateralAmount } = useFormatAmount()
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const principalPriceUsd = useAssetPriceUsd(principalAsset.id)

  const stats = useMemo<OverviewStat[]>(
    () => [
      {
        label: 'Total Collateral Locked',
        value: formatCollateralAmount(overview.totalCollateral),
        usdValue: formatUsd(overview.totalCollateral, collateralAsset.decimals, collateralPriceUsd),
        asset: collateralAsset,
      },
      {
        label: 'Total Active Loans',
        value: formatAmount(overview.totalActiveLoans, principalAsset.decimals),
        usdValue: formatUsd(overview.totalActiveLoans, principalAsset.decimals, principalPriceUsd),
        asset: principalAsset,
      },
      { label: 'Number of Active Loans', value: String(overview.activeLoansCount) },
    ],
    [
      overview,
      collateralAsset,
      principalAsset,
      collateralPriceUsd,
      principalPriceUsd,
      formatCollateralAmount,
    ],
  )

  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-6'>
      {stats.map(stat => {
        const Icon = stat.asset?.icon
        const unit = stat.asset ? getAssetUnit(denomination, stat.asset) : undefined
        return (
          <div
            key={stat.label}
            className='bg-surface-secondary flex flex-col gap-3 rounded-2xl p-4 sm:p-6'
          >
            <h3 className='text-muted text-h4'>{stat.label}</h3>
            {isLoading ? (
              <Skeleton className='h-8 w-24 rounded-lg' />
            ) : (
              <div className='flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <span
                    title={stat.value}
                    className='min-w-0 truncate text-2xl font-bold sm:text-display'
                  >
                    {stat.value}
                  </span>
                  {stat.asset && Icon && (
                    <span className='inline-flex shrink-0 items-center gap-1.5 text-sm font-medium'>
                      <Icon className='size-4' />
                      {unit}
                    </span>
                  )}
                </div>
                {stat.asset && (
                  <span title={stat.usdValue ?? undefined} className='text-muted truncate text-xs'>
                    {stat.usdValue ?? '—'}
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
