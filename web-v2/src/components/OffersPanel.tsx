import { Skeleton } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffers } from '@/api/indexer/hooks'
import type { OfferStatus } from '@/api/indexer/schemas'
import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import OffersTable from '@/components/OffersTable'
import { UiButton } from '@/components/ui/UiButton'

interface OffersPanelProps {
  title: string
  pageSize: number
  status?: OfferStatus
  onSuccess?: () => void
}

export default function OffersPanel({ title, pageSize, status, onSuccess }: OffersPanelProps) {
  const [page, setPage] = useState(1)

  const {
    data: offersData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useOffers(
    { status, limit: pageSize, offset: (page - 1) * pageSize },
    { placeholderData: keepPreviousData },
  )
  const { data: currentBlockHeight } = useBlockHeight()

  const offers = offersData?.items ?? []
  const pageCount = Math.ceil((offersData?.total ?? 0) / pageSize)

  const handleRetry = () => {
    refetch()
  }

  const handleSuccess = () => {
    refetch()
    onSuccess?.()
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
        <h3 className='text-h4'>{title}</h3>
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
          pageCount={pageCount}
          onPageChange={setPage}
          onActionSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
