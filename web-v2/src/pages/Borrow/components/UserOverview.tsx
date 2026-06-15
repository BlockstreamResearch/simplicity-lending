import { Skeleton } from '@heroui/react'

import { type ConfigAsset, NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrows } from '@/pages/Dashboard/hooks/useBorrows'
import { formatAmount } from '@/utils/format'
import { bpsToPercent } from '@/utils/offers'

interface OverviewTile {
  label: string
  value: string
  asset?: ConfigAsset
}

export default function UserOverview() {
  const { stats, isLoading } = useBorrows()
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
    <section className='flex flex-col gap-2'>
      <h2 className='text-muted text-[11px] font-semibold tracking-wide uppercase'>
        User Overview
      </h2>
      <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6'>
        {tiles.map(tile => {
          const Icon = tile.asset?.icon
          return (
            <div
              key={tile.label}
              className='bg-surface-secondary flex flex-col gap-3 rounded-3xl p-6'
            >
              <h3 className='text-muted text-h4'>{tile.label}</h3>
              {isLoading ? (
                <Skeleton className='h-8 w-20 rounded-lg' />
              ) : (
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-display'>{tile.value}</span>
                  {tile.asset && Icon && (
                    <span className='inline-flex items-center gap-1.5 text-sm font-medium'>
                      <Icon className='size-4' />
                      {tile.asset.symbol}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
