import { Skeleton } from '@heroui/react'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useBorrowerOffers } from '@/api/indexer/hooks'
import CoinsIcon from '@/components/icons/CoinsIcon'
import PlusIcon from '@/components/icons/PlusIcon'
import OffersTable from '@/components/OffersTable'
import { UiButton } from '@/components/ui/UiButton'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useWallet } from '@/providers/wallet/useWallet'

import CreateBorrowerAccountModal from './CreateBorrowerAccountModal'
import CreateBorrowOfferModal from './CreateBorrowOfferModal'

const BORROW_PAGE_SIZE = 10

export default function YourBorrows() {
  const [page, setPage] = useState(1)
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false)

  const { scriptPubkey } = useWallet()
  const { hasAccount } = useBorrowerAccount()

  const offset = (page - 1) * BORROW_PAGE_SIZE
  const borrowerQuery = useBorrowerOffers(scriptPubkey ?? '', {
    limit: BORROW_PAGE_SIZE,
    offset,
  })
  const { data: currentBlockHeight } = useBlockHeight()

  const offers = borrowerQuery.data?.items ?? []
  const totalOffers = borrowerQuery.data?.total ?? 0
  const pageCount = Math.ceil(totalOffers / BORROW_PAGE_SIZE)
  const isLoading = borrowerQuery.isLoading

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
      ) : offers.length === 0 ? (
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
          onActionSuccess={() => borrowerQuery.refetch()}
        />
      )}

      <UiButton variant='primary' className='self-start' onPress={handleCreateOffer}>
        <PlusIcon className='size-4' />
        Create Borrow Offer
      </UiButton>

      <CreateBorrowerAccountModal
        isOpen={isAccountModalOpen}
        onOpenChange={setIsAccountModalOpen}
      />
      <CreateBorrowOfferModal isOpen={isOfferModalOpen} onOpenChange={setIsOfferModalOpen} />
    </section>
  )
}
