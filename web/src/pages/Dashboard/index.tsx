import { useWallet } from '@/providers/wallet/useWallet'

import { BorrowCard } from './components/BorrowCard'
import OverviewStats from './components/OverviewStats'
import { RecentOffers } from './components/RecentOffers'
import { SupplyCard } from './components/SupplyCard'

export default function DashboardPage() {
  const { isReady } = useWallet()

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
