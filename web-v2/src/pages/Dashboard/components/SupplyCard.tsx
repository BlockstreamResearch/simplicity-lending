import { Skeleton } from '@heroui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { useLenderStats } from '@/hooks/useLenderStats'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatAmount, truncateAddress } from '@/utils/format'

import { AssetAmount } from './AssetAmount'
import CardAlert from './CardAlert'
import { DataRow } from './DataRow'

export function SupplyCard() {
  const navigate = useNavigate()
  const { balance, stats, repaidOffer, isLoading, error, refetch } = useLenderStats()

  useEffect(() => {
    if (error) ErrorHandler.processWithRetry(error, refetch, 'Failed to load your supply.')
  }, [error, refetch])

  return (
    <section className='bg-surface-secondary flex flex-1 flex-col gap-4 rounded-2xl p-4 sm:p-6'>
      <header className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground'>
            <ArrowSquareUpIcon className='size-5' />
          </span>
          <h3 className='text-h3'>Your Supply</h3>
        </div>
        <p className='text-muted text-h4'>
          Complete Balance {NETWORK_CONFIG.principalAsset.symbol}
        </p>
      </header>

      {isLoading ? (
        <Skeleton className='h-8 w-32 rounded-lg' />
      ) : (
        <p className='text-display'>
          <AssetAmount
            value={formatAmount(balance, NETWORK_CONFIG.principalAsset.decimals)}
            unit={NETWORK_CONFIG.principalAsset.symbol}
          />
        </p>
      )}

      <div className='bg-surface flex flex-col gap-3 rounded-lg p-4 sm:p-6'>
        <DataRow
          label='Supplied Loans:'
          value={`${formatAmount(stats.suppliedLoans, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol}`}
          isLoading={isLoading}
        />
        <DataRow
          label='Interest Outstanding:'
          value={`${formatAmount(stats.interestOutstanding, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol}`}
          isLoading={isLoading}
        />
        <DataRow label='Number of Active Loans:' value={stats.activeLoans} isLoading={isLoading} />
        <DataRow
          label='Number of Repaid to be Claimed Loans:'
          value={stats.repaidToClaim}
          isLoading={isLoading}
        />
      </div>

      {repaidOffer && (
        <CardAlert
          variant='accent'
          title='Repayment Available'
          description={`Loan #${truncateAddress(repaidOffer.id)} has been repaid. You can now claim the repayment.`}
          actionLabel='Claim Now'
          isDisabled
        />
      )}

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Supply)}>
        Supply
      </UiButton>
    </section>
  )
}
