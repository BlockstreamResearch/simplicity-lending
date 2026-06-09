import { Skeleton } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffers } from '@/api/indexer/hooks'
import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import { UiButton } from '@/components/ui/UiButton'

import { DASHBOARD_REFETCH_INTERVAL_MS, TABLE_PAGE_SIZE } from '../constants'
import { OffersTable } from './OffersTable'

export function RecentOffers() {
  const [page, setPage] = useState(1)
  const offset = (page - 1) * TABLE_PAGE_SIZE

  const offersQuery = useOffers(
    { limit: TABLE_PAGE_SIZE + 1, offset },
    { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS, placeholderData: keepPreviousData },
  )
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)
  const currentBlockHeight = blockHeightQuery.data ?? 0

  const rawOffers = offersQuery.data ?? []
  const hasNextPage = rawOffers.length > TABLE_PAGE_SIZE
  const offers = rawOffers.slice(0, TABLE_PAGE_SIZE)

  const isLoading = offersQuery.isLoading || blockHeightQuery.isLoading
  const isFetching = offersQuery.isFetching || blockHeightQuery.isFetching
  const error = (offersQuery.error ?? blockHeightQuery.error) as Error | null

  const handleRetry = () => {
    void offersQuery.refetch()
    void blockHeightQuery.refetch()
  }

  return (
    <div className='bg-surface-secondary flex flex-col gap-6 rounded-2xl p-4 sm:p-6'>
      <header className='flex items-center gap-3'>
        <button
          type='button'
          aria-label='Refresh offers'
          onClick={handleRetry}
          className='text-muted hover:text-foreground disabled:opacity-60'
          disabled={isFetching}
        >
          <ArrowsRotateIcon className={`size-5 ${isFetching ? 'animate-spin' : ''}`} />
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
        <div className='flex flex-col items-center gap-3 py-10'>
          <p className='text-danger text-sm'>{error.message || 'Failed to load offers.'}</p>
          <UiButton variant='secondary' onPress={handleRetry}>
            Retry
          </UiButton>
        </div>
      ) : offers.length === 0 ? (
        <p className='text-muted py-10 text-center text-sm'>No offers found</p>
      ) : (
        <OffersTable
          offers={offers}
          currentBlockHeight={currentBlockHeight}
          page={page}
          hasNextPage={hasNextPage}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
