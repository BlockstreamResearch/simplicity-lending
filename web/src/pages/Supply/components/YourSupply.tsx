import { Skeleton } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useLenderOffers } from '@/api/indexer/hooks'
import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import OffersTable from '@/components/OffersTable'
import { useOfferListControls } from '@/hooks/useOfferListControls'
import { useWallet } from '@/providers/wallet/useWallet'

const SUPPLY_PAGE_SIZE = 10

export default function YourSupply() {
  const { scriptPubkey } = useWallet()
  const { data: currentBlockHeight } = useBlockHeight()

  const { page, setPage, params, sort, setSort, statusFilter, setStatusFilter } =
    useOfferListControls({ pageSize: SUPPLY_PAGE_SIZE })

  const { data: lenderData, isLoading } = useLenderOffers(scriptPubkey ?? '', params, {
    placeholderData: keepPreviousData,
  })

  const offers = lenderData?.items ?? []
  const totalOffers = lenderData?.total ?? 0
  const pageCount = Math.ceil(totalOffers / SUPPLY_PAGE_SIZE)

  return (
    <div className='bg-surface-secondary flex flex-col gap-3 rounded-3xl p-6'>
      <header className='flex items-center gap-1.75'>
        <ArrowSquareUpIcon className='size-6' />
        <h3 className='text-foreground text-[11px] font-semibold uppercase tracking-[0.0061em]'>
          Your Supply
        </h3>
      </header>

      {isLoading ? (
        <div className='flex flex-col gap-1'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-14 w-full' />
          ))}
        </div>
      ) : !offers.length && !statusFilter.length ? (
        <p className='text-muted py-6 text-center text-sm'>No active loans</p>
      ) : (
        <OffersTable
          offers={offers}
          currentBlockHeight={currentBlockHeight}
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          sort={sort}
          onSortChange={setSort}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      )}
    </div>
  )
}
