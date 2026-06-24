import { Skeleton } from '@heroui/react'

import { type ConfigAsset } from '@/constants/network-config'

export interface OverviewTile {
  label: string
  value: string
  usdValue?: string | null
  asset?: ConfigAsset | null
}

interface UserOverviewProps {
  tiles: OverviewTile[]
  isLoading?: boolean
  gridClassName?: string
}

export default function UserOverview({
  tiles,
  isLoading,
  gridClassName = 'grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-6',
}: UserOverviewProps) {
  return (
    <section className='flex flex-col gap-2'>
      <h2 className='text-muted text-[11px] font-semibold tracking-wide uppercase'>
        User Overview
      </h2>
      <div className={gridClassName}>
        {tiles.map(tile => {
          const Icon = tile.asset?.icon
          return (
            <div
              key={tile.label}
              className='bg-surface-secondary flex flex-col gap-3 rounded-3xl p-4 sm:p-6'
            >
              <h3 className='text-muted text-h4'>{tile.label}</h3>
              {isLoading ? (
                <Skeleton className='h-8 w-20 rounded-lg' />
              ) : (
                <div className='flex flex-col gap-1'>
                  <div className='flex items-center gap-2'>
                    <span
                      title={tile.value}
                      className='min-w-0 truncate text-2xl font-bold sm:text-display'
                    >
                      {tile.value}
                    </span>
                    {tile.asset && Icon && (
                      <span className='inline-flex shrink-0 items-center gap-1.5 text-sm font-medium'>
                        <Icon className='size-4' />
                        {tile.asset.symbol}
                      </span>
                    )}
                  </div>
                  {tile.asset && (
                    <span
                      title={tile.usdValue ?? undefined}
                      className='text-muted truncate text-xs'
                    >
                      {tile.usdValue ?? '—'}
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
