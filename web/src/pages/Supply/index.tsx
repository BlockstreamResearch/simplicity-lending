import { Spinner } from '@heroui/react'
import { useMemo } from 'react'

import type { OfferFilters } from '@/api/indexer/methods'
import BackLink from '@/components/BackLink'
import OffersPanel from '@/components/OffersPanel'
import UserBalances from '@/components/UserBalances'
import { WalletButton } from '@/components/WalletButton'
import { useWallet } from '@/providers/walletFacade/useWallet'

import SupplyOverview from './components/SupplyOverview'
import YourSupply from './components/YourSupply'

const BORROW_OFFERS_PAGE_SIZE = 10

export default function SupplyPage() {
  const { isReady, reconnecting, scriptPubkey } = useWallet()

  const acceptableOffersFilters: OfferFilters = useMemo(
    () => ({
      status: 'pending',
      notExpired: true,
      excludeParticipantScript: scriptPubkey ?? undefined,
    }),
    [scriptPubkey],
  )

  return (
    <div className='flex flex-col gap-6'>
      <BackLink />

      {(() => {
        if (isReady) {
          return (
            <div className='flex flex-col gap-8'>
              <UserBalances />
              <SupplyOverview />
              <YourSupply />
              <OffersPanel
                title='Most recent Borrow Offers'
                pageSize={BORROW_OFFERS_PAGE_SIZE}
                filters={acceptableOffersFilters}
              />
            </div>
          )
        }

        if (reconnecting) {
          return (
            <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
              <Spinner size='md' />
              <p className='text-muted'>Reconnecting…</p>
            </div>
          )
        }

        return (
          <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
            <p className='text-muted'>Connect your wallet to supply liquidity.</p>
            <WalletButton />
          </div>
        )
      })()}
    </div>
  )
}
