import { Skeleton } from '@heroui/react'
import { useMemo } from 'react'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import { type ConfigAsset, NETWORK_CONFIG } from '@/constants/network-config'
import { useOverview } from '@/hooks/useOverview'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { formatAmount, formatUsd } from '@/utils/format'
import {
  formatPolicyAssetAmount,
  getPolicyAssetUnit,
  isPolicyAsset,
} from '@/utils/policyAssetDenomination'

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
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const principalPriceUsd = useAssetPriceUsd(principalAsset.id)

  const stats = useMemo<OverviewStat[]>(
    () => [
      {
        label: 'Total Collateral Locked',
        value: formatPolicyAssetAmount(overview.totalCollateral, denomination, collateralAsset),
        usdValue: formatUsd(overview.totalCollateral, collateralAsset.decimals, collateralPriceUsd),
        asset: collateralAsset,
      },
      {
        label: 'Total Active Loans',
        value: formatAmount(overview.totalActiveLoans, principalAsset.decimals),
        usdValue: formatUsd(overview.totalActiveLoans, principalAsset.decimals, principalPriceUsd),
        asset: principalAsset,
      },
      // TODO: show real value once /offers/overview returns an average interest rate (backend doesn't expose it yet).
      { label: 'Average Interest Rate', value: '—' },
      { label: 'Number of Active Loans', value: String(overview.activeLoansCount) },
    ],
    [
      overview,
      collateralAsset,
      principalAsset,
      collateralPriceUsd,
      principalPriceUsd,
      denomination,
    ],
  )

  return (
    <div className='grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6'>
      {stats.map(stat => {
        const Icon = stat.asset?.icon
        const unit =
          stat.asset && isPolicyAsset(stat.asset)
            ? getPolicyAssetUnit(denomination, stat.asset)
            : stat.asset?.symbol
        return (
          <div
            key={stat.label}
            className='bg-surface-secondary flex flex-col gap-3 rounded-2xl p-6'
          >
            <h3 className='text-muted text-h4'>{stat.label}</h3>
            {isLoading ? (
              <Skeleton className='h-8 w-24 rounded-lg' />
            ) : (
              <div className='flex flex-col gap-1'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-display'>{stat.value}</span>
                  {stat.asset && Icon && (
                    <span className='inline-flex items-center gap-1.5 text-sm font-medium'>
                      <Icon className='size-4' />
                      {unit}
                    </span>
                  )}
                </div>
                {stat.asset && <span className='text-muted text-xs'>{stat.usdValue ?? '—'}</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
