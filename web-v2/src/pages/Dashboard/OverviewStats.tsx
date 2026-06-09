import { Skeleton } from '@heroui/react'
import { useMemo } from 'react'

import { LENDING } from '@/constants/config'
import { formatAmount } from '@/utils/format'
import { bpsToPercent } from '@/utils/offers'

import { AssetAmount } from './AssetAmount'
import { useOverview } from './useOverview'

interface OverviewStat {
  label: string
  value: string
  unit?: string
}

export default function OverviewStats() {
  const { overview, isLoading } = useOverview()

  const stats = useMemo<OverviewStat[]>(
    () => [
      {
        label: 'Total Collateral Locked',
        value: formatAmount(overview.totalCollateral, LENDING.collateralDecimals),
        unit: LENDING.collateralSymbol,
      },
      {
        label: 'Total Active Loans',
        value: formatAmount(overview.totalActiveLoans, LENDING.principalDecimals),
        unit: LENDING.principalSymbol,
      },
      { label: 'Average Interest Rate', value: bpsToPercent(overview.avgInterestRate) },
      { label: 'Number of Active Loans', value: String(overview.activeLoansCount) },
    ],
    [overview],
  )

  return (
    <div className='grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6'>
      {stats.map(stat => (
        <div key={stat.label} className='bg-surface-secondary flex flex-col gap-3 rounded-2xl p-6'>
          <h3 className='text-muted text-h4'>{stat.label}</h3>
          {isLoading ? (
            <Skeleton className='h-8 w-24 rounded-lg' />
          ) : (
            <p className='text-display'>
              {stat.unit ? <AssetAmount value={stat.value} unit={stat.unit} /> : stat.value}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
