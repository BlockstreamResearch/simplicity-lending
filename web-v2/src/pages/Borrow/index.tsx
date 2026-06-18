import { Spinner } from '@heroui/react'

import BackLink from '@/components/BackLink'
import UserBalances from '@/components/UserBalances'
import { WalletButton } from '@/components/WalletButton'
import { useWallet } from '@/providers/wallet/useWallet'

import BorrowOverview from './components/BorrowOverview'
import YourBorrows from './components/YourBorrows'

export default function BorrowPage() {
  const { isReady, reconnecting } = useWallet()

  return (
    <div className='flex flex-col gap-6'>
      <BackLink />

      {(() => {
        if (isReady) {
          return (
            <div className='flex flex-col gap-8'>
              <UserBalances />
              <BorrowOverview />
              <YourBorrows />
            </div>
          )
        }

        if (reconnecting) {
          return (
            <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
              <Spinner size='md' />
              <p className='text-muted'>Reconnecting your wallet…</p>
            </div>
          )
        }

        return (
          <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
            <p className='text-muted'>Connect your wallet to view your borrows.</p>
            <WalletButton />
          </div>
        )
      })()}
    </div>
  )
}
