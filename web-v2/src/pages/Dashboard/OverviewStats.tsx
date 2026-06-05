import { Skeleton } from '@heroui/react'
import { useMemo } from 'react'

import { ASSET_DECIMALS } from '@/constants/assets'
import { formatAsset, USD_PLACEHOLDER } from '@/utils/format'
import { bpsToPercent } from '@/utils/lending'

import { AssetAmount } from './BaseCard'
import type { DashboardOverview } from './useDashboard'

interface OverviewStatsProps {
  data: DashboardOverview
  isLoading: boolean
}

interface OverviewStat {
  label: string
  value: string
  unit?: string
  // No price oracle yet, so monetary tiles fall back to USD_PLACEHOLDER.
  fiat?: string
}

const GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6'

function Tile({ label, value, unit, fiat, isLoading }: OverviewStat & { isLoading?: boolean }) {
  return (
    <div className='bg-surface-secondary flex flex-col gap-3 rounded-2xl p-6'>
      <h4 className='text-muted text-h4'>{label}</h4>
      {isLoading ? (
        <Skeleton className='h-8 w-24 rounded-lg' />
      ) : (
        <div>
          <p className='text-display'>{unit ? <AssetAmount value={value} unit={unit} /> : value}</p>
          {fiat && <p className='text-muted mt-1 text-xs'>{fiat}</p>}
        </div>
      )}
    </div>
  )
}

export function OverviewStats({ data, isLoading }: OverviewStatsProps) {
  const stats = useMemo<OverviewStat[]>(
    () => [
      {
        label: 'Collateral Locked',
        value: formatAsset(data.totalCollateral, ASSET_DECIMALS.LBTC),
        unit: 'LBTC',
        fiat: USD_PLACEHOLDER,
      },
      {
        label: 'Borrowings',
        value: formatAsset(data.totalBorrowings, ASSET_DECIMALS.USDT),
        unit: 'USDT',
        fiat: USD_PLACEHOLDER,
      },
      { label: 'Average APR', value: bpsToPercent(data.avgApr) },
      { label: 'Active Loans', value: String(data.activeLoans) },
      { label: 'Pending Offers', value: String(data.pendingOffers) },
    ],
    [data],
  )

  return (
    <div className={GRID}>
      {stats.map(stat => (
        <Tile key={stat.label} {...stat} isLoading={isLoading} />
      ))}
    </div>
  )
}
