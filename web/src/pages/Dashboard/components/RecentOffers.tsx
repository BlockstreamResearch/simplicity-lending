import { Skeleton } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffers } from '@/api/indexer/hooks'
import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import { OffersLoadError } from '@/components/OffersLoadError'
import OffersTable from '@/components/OffersTable'
import { useOfferListControls } from '@/hooks/useOfferListControls'

import { DASHBOARD_TABLE_PAGE_SIZE } from '../constants'

export function RecentOffers() {
  const { page, setPage, params, sort, setSort, statusFilter, setStatusFilter } =
    useOfferListControls({ pageSize: DASHBOARD_TABLE_PAGE_SIZE })

  const {
    data: offersData,
    isLoading,
    isFetching,
    error,
    refetch: refetchOffers,
  } = useOffers(params, { placeholderData: keepPreviousData })
  const { data: currentBlockHeight, refetch: refetchBlockHeight } = useBlockHeight()

  const [manualSpin, setManualSpin] = useState(false)
  const isSpinning = isFetching || manualSpin

  const offers = offersData?.items ?? []
  const total = offersData?.total ?? 0
  const pageCount = Math.ceil(total / DASHBOARD_TABLE_PAGE_SIZE)

  const handleRetry = () => {
    setManualSpin(true)
    refetchOffers()
    refetchBlockHeight()
  }

  return (
    <div className='bg-surface-secondary flex flex-col gap-6 rounded-2xl p-4 sm:p-6'>
      <header className='flex items-center gap-3'>
        <button
          type='button'
          aria-label='Refresh offers'
          onClick={handleRetry}
          className='text-muted hover:text-foreground disabled:opacity-60'
          disabled={isSpinning}
        >
          <ArrowsRotateIcon
            className={`size-5 ${isSpinning ? 'animate-spin' : ''}`}
            onAnimationIteration={() => setManualSpin(false)}
          />
        </button>
        <h3 className='text-h4'>Most recent Borrow Offers</h3>
      </header>

      {isLoading ? (
        <div className='flex flex-col gap-3'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : error ? (
        <OffersLoadError error={error} onRetry={handleRetry} />
      ) : (
        <div
          aria-busy={isSpinning}
          className={`transition-opacity ${isSpinning ? 'pointer-events-none opacity-60' : ''}`}
        >
          <OffersTable
            offers={offers}
            currentBlockHeight={currentBlockHeight}
            page={page}
            pageCount={pageCount}
            emptyMessage='No offers found'
            onPageChange={setPage}
            sort={sort}
            onSortChange={setSort}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />
        </div>
      )}
    </div>
  )
}
