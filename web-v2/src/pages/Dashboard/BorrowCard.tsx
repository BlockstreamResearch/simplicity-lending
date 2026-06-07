import { useNavigate } from 'react-router-dom'

import CoinsIcon from '@/components/icons/CoinsIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiDataRow, UiDataRows } from '@/components/ui/UiDataRow'
import { ASSET_DECIMALS } from '@/constants/assets'
import { RoutePath } from '@/constants/routes'
import { formatAsset, truncateAddress } from '@/utils/format'

import { BalanceCard } from './BalanceCard'
import { AssetAmount, CardAlert } from './BaseCard'
import type { DashboardBorrows } from './useDashboard'

interface BorrowCardProps {
  data: DashboardBorrows
  isLoading: boolean
  isReady: boolean
  onRetry: () => void
}

export function BorrowCard({ data, isLoading, isReady, onRetry }: BorrowCardProps) {
  const navigate = useNavigate()
  const { stats, nearExpiryOffers } = data
  const alertOffer = nearExpiryOffers[0]

  return (
    <BalanceCard
      icon={<CoinsIcon className='size-5' />}
      title='Your Borrows'
      subtitle='Complete Balance LBTC'
      isLoading={isLoading}
      isReady={isReady}
      error={data.error}
      connectMessage='Connect your wallet to view your borrows.'
      errorMessage='Failed to load your borrows.'
      onRetry={onRetry}
      balance={<AssetAmount value={formatAsset(data.balance, ASSET_DECIMALS.LBTC)} unit='LBTC' />}
    >
      <UiDataRows>
        <UiDataRow
          label='User Total Locked Collateral:'
          value={`${formatAsset(stats.lockedCollateral, ASSET_DECIMALS.LBTC)} LBTC`}
          isLoading={isLoading}
        />
        <UiDataRow
          label='Borrowings:'
          value={`${formatAsset(stats.borrowings, ASSET_DECIMALS.USDT)} USDT`}
          isLoading={isLoading}
        />
        <UiDataRow
          label='Number of active loans:'
          value={stats.activeLoans}
          isLoading={isLoading}
        />
        <UiDataRow
          label='Number of pending offers:'
          value={stats.pendingOffers}
          isLoading={isLoading}
        />
      </UiDataRows>

      {alertOffer && (
        <CardAlert
          variant='warning'
          title='Repayment Due Soon'
          description={`Loan #${truncateAddress(alertOffer.id)} Nearing Deadline. Repay to Avoid Liquidation.`}
          actionLabel='Repay Now'
          isDisabled
        />
      )}

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Borrow)}>
        Borrow
      </UiButton>
    </BalanceCard>
  )
}
