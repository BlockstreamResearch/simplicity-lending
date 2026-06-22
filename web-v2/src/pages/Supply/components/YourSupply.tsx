import { Skeleton } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useLenderOffers } from '@/api/indexer/hooks'
import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import OffersTable from '@/components/OffersTable'
import { useWallet } from '@/providers/wallet/useWallet'

const SUPPLY_PAGE_SIZE = 10

export default function YourSupply() {
  const [page, setPage] = useState(1)
  const { scriptPubkey } = useWallet()
  const { data: currentBlockHeight } = useBlockHeight()

  const offset = (page - 1) * SUPPLY_PAGE_SIZE
  const lenderQuery = useLenderOffers(
    scriptPubkey ?? '',
    { limit: SUPPLY_PAGE_SIZE, offset },
    { placeholderData: keepPreviousData },
  )

  const offers = lenderQuery.data?.items ?? []
  const totalOffers = lenderQuery.data?.total ?? 0
  const pageCount = Math.ceil(totalOffers / SUPPLY_PAGE_SIZE)
  const isLoading = lenderQuery.isLoading

  return (
    <div className='bg-surface-secondary flex flex-col gap-3 rounded-3xl p-6'>
      <header className='flex items-center gap-2'>
        <ArrowSquareUpIcon className='size-6' />
        <h3 className='text-[11px] font-semibold uppercase tracking-wide'>Your Supply</h3>
      </header>

      {isLoading ? (
        <div className='flex flex-col gap-3'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : !offers.length ? (
        <p className='text-muted py-6 text-center text-sm'>No active loans</p>
      ) : (
        <OffersTable
          offers={offers}
          currentBlockHeight={currentBlockHeight}
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          onActionSuccess={() => lenderQuery.refetch()}
        />
      )}
    </div>
  )
}
