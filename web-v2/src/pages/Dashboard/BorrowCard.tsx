import { Skeleton } from '@heroui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import CoinsIcon from '@/components/icons/CoinsIcon'
import { UiButton } from '@/components/ui/UiButton'
import { LENDING } from '@/constants/config'
import { RoutePath } from '@/constants/routes'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatAmount, truncateAddress } from '@/utils/format'

import { AssetAmount } from './AssetAmount'
import { CardAlert } from './CardAlert'
import { DataRow, DataRows } from './DataRow'
import { useBorrows } from './useBorrows'

export function BorrowCard() {
  const navigate = useNavigate()
  const { balance, stats, nearExpiryOffers, isLoading, error, unsupported, refetch } = useBorrows()
  const alertOffer = nearExpiryOffers[0]

  useEffect(() => {
    if (error) ErrorHandler.processWithRetry(error, refetch, 'Failed to load your borrows.')
  }, [error, refetch])

  // This wallet can't expose a borrower key → nothing to show.
  if (unsupported) return null

  return (
    <section className='bg-surface-secondary flex flex-1 flex-col gap-4 rounded-2xl p-4 sm:p-6'>
      <header className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground'>
            <CoinsIcon className='size-5' />
          </span>
          <h3 className='text-h3'>Your Borrows</h3>
        </div>
        <p className='text-muted text-h4'>Complete Balance {LENDING.collateralSymbol}</p>
      </header>

      {isLoading ? (
        <Skeleton className='h-8 w-32 rounded-lg' />
      ) : (
        <p className='text-display'>
          <AssetAmount
            value={formatAmount(balance, LENDING.collateralDecimals)}
            unit={LENDING.collateralSymbol}
          />
        </p>
      )}

      <DataRows>
        <DataRow
          label='User Total Locked Collateral:'
          value={`${formatAmount(stats.lockedCollateral, LENDING.collateralDecimals)} ${LENDING.collateralSymbol}`}
          isLoading={isLoading}
        />
        <DataRow
          label='Borrowings:'
          value={`${formatAmount(stats.borrowings, LENDING.principalDecimals)} ${LENDING.principalSymbol}`}
          isLoading={isLoading}
        />
        <DataRow label='Number of active loans:' value={stats.activeLoans} isLoading={isLoading} />
        <DataRow
          label='Number of pending offers:'
          value={stats.pendingOffers}
          isLoading={isLoading}
        />
      </DataRows>

      {alertOffer && (
        <CardAlert
          variant='warning'
          title='Repayment Due Soon'
          description={`Loan #${truncateAddress(alertOffer.id)} Nearing Deadline. Repay to Avoid Liquidation.`}
          actionLabel='Repay Now'
          isDisabled
        />
      )}

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Borrow)}>
        Borrow
      </UiButton>
    </section>
  )
}
