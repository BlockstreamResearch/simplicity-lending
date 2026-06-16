import { Spinner } from '@heroui/react'

import BackLink from '@/components/BackLink'
import { WalletButton } from '@/components/WalletButton'
import { useBorrows } from '@/hooks/useBorrows'
import { useWallet } from '@/providers/wallet/useWallet'

import UserBalances from './components/UserBalances'
import UserOverview from './components/UserOverview'
import YourBorrows from './components/YourBorrows'

export default function BorrowPage() {
  const { isReady, reconnecting } = useWallet()
  const { stats, offers, totalOffers, page, setPage, currentBlockHeight, isLoading } = useBorrows()

  return (
    <div className='flex flex-col gap-6'>
      <BackLink />

      {isReady ? (
        <div className='flex flex-col gap-8'>
          <UserBalances />
          <UserOverview stats={stats} isLoading={isLoading} />
          <YourBorrows
            offers={offers}
            totalOffers={totalOffers}
            page={page}
            setPage={setPage}
            currentBlockHeight={currentBlockHeight}
            isLoading={isLoading}
          />
        </div>
      ) : reconnecting ? (
        <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
          <Spinner size='md' />
          <p className='text-muted'>Reconnecting your wallet…</p>
        </div>
      ) : (
        <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
          <p className='text-muted'>Connect your wallet to view your borrows.</p>
          <WalletButton />
        </div>
      )}
    </div>
  )
}
