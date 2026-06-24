import { Skeleton } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useBorrowerOffers } from '@/api/indexer/hooks'
import CoinsIcon from '@/components/icons/CoinsIcon'
import PlusIcon from '@/components/icons/PlusIcon'
import OffersTable from '@/components/OffersTable'
import { UiButton } from '@/components/ui/UiButton'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useOfferListControls } from '@/hooks/useOfferListControls'
import { useWallet } from '@/providers/wallet/useWallet'

import CreateBorrowerAccountModal from './CreateBorrowerAccountModal'
import CreateBorrowOfferModal from './CreateBorrowOfferModal'

const BORROW_PAGE_SIZE = 10

export default function YourBorrows() {
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false)

  const { scriptPubkey } = useWallet()
  const { hasAccount } = useBorrowerAccount()

  const { page, setPage, params, sort, setSort, statusFilter, setStatusFilter } =
    useOfferListControls({ pageSize: BORROW_PAGE_SIZE })

  const {
    data: borrowerData,
    isLoading,
    refetch,
  } = useBorrowerOffers(scriptPubkey ?? '', params, { placeholderData: keepPreviousData })
  const { data: currentBlockHeight } = useBlockHeight()

  const offers = borrowerData?.items ?? []
  const totalOffers = borrowerData?.total ?? 0
  const pageCount = Math.ceil(totalOffers / BORROW_PAGE_SIZE)

  const handleCreateOffer = () => {
    if (hasAccount) setIsOfferModalOpen(true)
    else setIsAccountModalOpen(true)
  }

  return (
    <section className='bg-surface-secondary flex flex-col gap-6 rounded-3xl p-6'>
      <header className='flex items-center gap-2'>
        <CoinsIcon className='size-5' />
        <h2 className='text-foreground text-[11px] font-semibold tracking-wide uppercase'>
          Your Borrows
        </h2>
      </header>

      {isLoading ? (
        <div className='flex flex-col gap-1'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-14 w-full rounded' />
          ))}
        </div>
      ) : offers.length === 0 && !statusFilter.length ? (
        <div className='bg-surface border-muted flex h-14 items-center rounded border border-dashed px-4 opacity-50'>
          <span className='text-foreground text-sm font-medium'>No borrow offers yet.</span>
        </div>
      ) : (
        <OffersTable
          offers={offers}
          currentBlockHeight={currentBlockHeight}
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          onActionSuccess={() => refetch()}
          sort={sort}
          onSortChange={setSort}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      )}

      <UiButton variant='primary' className='self-start' onPress={handleCreateOffer}>
        <PlusIcon className='size-4' />
        Create Borrow Offer
      </UiButton>

      <CreateBorrowerAccountModal
        isOpen={isAccountModalOpen}
        onOpenChange={setIsAccountModalOpen}
        onClose={refetch}
      />
      <CreateBorrowOfferModal
        isOpen={isOfferModalOpen}
        onOpenChange={setIsOfferModalOpen}
        onClose={refetch}
      />
    </section>
  )
}
