import BackLink from '@/components/BackLink'
import { WalletButton } from '@/components/WalletButton'
import { useWallet } from '@/providers/wallet/useWallet'

import UserBalances from './components/UserBalances'
import UserOverview from './components/UserOverview'
import YourBorrows from './components/YourBorrows'

export default function BorrowPage() {
  const { isReady } = useWallet()

  return (
    <div className='flex flex-col gap-6'>
      <BackLink />

      {isReady ? (
        <div className='flex flex-col gap-8'>
          <UserBalances />
          <UserOverview />
          <YourBorrows />
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
