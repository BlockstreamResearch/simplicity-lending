import { Skeleton } from '@heroui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import { UiButton } from '@/components/ui/UiButton'
import { LENDING } from '@/constants/config'
import { RoutePath } from '@/constants/routes'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatAmount, truncateAddress } from '@/utils/format'

import { AssetAmount } from './AssetAmount'
import { CardAlert } from './CardAlert'
import { DataRow, DataRows } from './DataRow'
import { useSupply } from './useSupply'

export function SupplyCard() {
  const navigate = useNavigate()
  const { balance, stats, claimableOffers, isLoading, error, refetch } = useSupply()
  const alertOffer = claimableOffers[0]

  useEffect(() => {
    if (error) ErrorHandler.processWithRetry(error, refetch, 'Failed to load your supply.')
  }, [error, refetch])

  return (
    <section className='bg-surface-secondary flex flex-1 flex-col gap-4 rounded-2xl p-4 sm:p-6'>
      <header className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground'>
            <ArrowSquareUpIcon className='size-5' />
          </span>
          <h3 className='text-h3'>Your Supply</h3>
        </div>
        <p className='text-muted text-h4'>Complete Balance {LENDING.principalSymbol}</p>
      </header>

      {isLoading ? (
        <Skeleton className='h-8 w-32 rounded-lg' />
      ) : (
        <p className='text-display'>
          <AssetAmount
            value={formatAmount(balance, LENDING.principalDecimals)}
            unit={LENDING.principalSymbol}
          />
        </p>
      )}

      <DataRows>
        <DataRow
          label='Supplied Loans:'
          value={`${formatAmount(stats.suppliedLoans, LENDING.principalDecimals)} ${LENDING.principalSymbol}`}
          isLoading={isLoading}
        />
        <DataRow
          label='Interest Outstanding:'
          value={`${formatAmount(stats.interestOutstanding, LENDING.principalDecimals)} ${LENDING.principalSymbol}`}
          isLoading={isLoading}
        />
        <DataRow label='Number of Active Loans:' value={stats.activeLoans} isLoading={isLoading} />
        <DataRow
          label='Number of Repaid to be Claimed Loans:'
          value={stats.repaidToClaim}
          isLoading={isLoading}
        />
      </DataRows>

      {alertOffer && (
        <CardAlert
          variant='accent'
          title='Repayment Available'
          description={`Loan #${truncateAddress(alertOffer.id)} has been repaid. You can now claim the repayment.`}
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
