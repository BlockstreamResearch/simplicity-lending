import { Skeleton } from '@heroui/react'
import { useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import OfferActionModals from '@/components/modals/OfferActionModals'
import OffersTable from '@/components/OffersTable'
import { useLenderStats } from '@/hooks/useLenderStats'

export default function YourSupply() {
  const blockHeightQuery = useBlockHeight()
  const currentBlockHeight = blockHeightQuery.data ?? 0

  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)

  const { offers: lenderOffers, isLoading, refetch } = useLenderStats()

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
      ) : !lenderOffers.length ? (
        <p className='text-muted py-6 text-center text-sm'>No active lends</p>
      ) : (
        <OffersTable
          offers={lenderOffers}
          currentBlockHeight={currentBlockHeight}
          onRowPress={setSelectedOffer}
        />
      )}

      <OfferActionModals
        offer={selectedOffer}
        viewerRole='lender'
        onClose={() => setSelectedOffer(null)}
        onSuccess={() => {
          setSelectedOffer(null)
          refetch()
        }}
      />
    </div>
  )
}
