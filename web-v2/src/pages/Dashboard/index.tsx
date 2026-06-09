import { useWallet } from '@/providers/wallet/useWallet'

import { BorrowCard } from './BorrowCard'
import OverviewStats from './OverviewStats'
import { RecentOffers } from './RecentOffers'
import { SupplyCard } from './SupplyCard'

export default function DashboardPage() {
  const { connectionStatus } = useWallet()
  const isReady = connectionStatus === 'ready'

  return (
    <div className='flex flex-col gap-6'>
      <section className='flex flex-col gap-2'>
        <h2 className='text-muted text-xs font-medium tracking-wide uppercase'>General Overview</h2>
        <OverviewStats />
      </section>

      {isReady && (
        <div className='flex flex-col gap-6 lg:flex-row'>
          <BorrowCard />
          <SupplyCard />
        </div>
      )}

      <RecentOffers />
    </div>
  )
}
