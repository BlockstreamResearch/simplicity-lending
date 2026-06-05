import { BorrowCard } from './BorrowCard'
import { OffersTable } from './OffersTable'
import { OverviewStats } from './OverviewStats'
import { SupplyCard } from './SupplyCard'
import { useDashboard } from './useDashboard'

export default function DashboardPage() {
  const { overview, borrows, supply, isLoading, isReady, refetch } = useDashboard()

  return (
    <div className='flex flex-col gap-6'>
      <section className='flex flex-col gap-2'>
        <h2 className='text-muted text-xs font-medium tracking-wide uppercase'>General Overview</h2>
        <OverviewStats data={overview} isLoading={isLoading} />
      </section>

      <div className='flex flex-col gap-6 lg:flex-row'>
        <BorrowCard
          data={borrows}
          isLoading={borrows.isLoading}
          isReady={isReady}
          onRetry={refetch}
        />
        <SupplyCard
          data={supply}
          isLoading={supply.isLoading}
          isReady={isReady}
          onRetry={refetch}
        />
      </div>

      <OffersTable />
    </div>
  )
}
