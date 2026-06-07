import { useNavigate } from 'react-router-dom'

import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiDataRow, UiDataRows } from '@/components/ui/UiDataRow'
import { ASSET_DECIMALS } from '@/constants/assets'
import { RoutePath } from '@/constants/routes'
import { formatAsset, truncateAddress } from '@/utils/format'

import { BalanceCard } from './BalanceCard'
import { AssetAmount, CardAlert } from './BaseCard'
import type { DashboardSupply } from './useDashboard'

interface SupplyCardProps {
  data: DashboardSupply
  isLoading: boolean
  isReady: boolean
  onRetry: () => void
}

export function SupplyCard({ data, isLoading, isReady, onRetry }: SupplyCardProps) {
  const navigate = useNavigate()
  const { stats, claimableOffers } = data
  const alertOffer = claimableOffers[0]

  return (
    <BalanceCard
      icon={<ArrowSquareUpIcon className='size-5' />}
      title='Your Supply'
      subtitle='Complete Balance USDT'
      isLoading={isLoading}
      isReady={isReady}
      error={data.error}
      connectMessage='Connect your wallet to view your supply.'
      errorMessage='Failed to load your supply.'
      onRetry={onRetry}
      balance={<AssetAmount value={formatAsset(data.balance, ASSET_DECIMALS.USDT)} unit='USDT' />}
    >
      <UiDataRows>
        <UiDataRow
          label='Supplied Loans:'
          value={`${formatAsset(stats.suppliedLoans, ASSET_DECIMALS.USDT)} USDT`}
          isLoading={isLoading}
        />
        <UiDataRow
          label='Interest Outstanding:'
          value={`${formatAsset(stats.interestOutstanding, ASSET_DECIMALS.USDT)} USDT`}
          isLoading={isLoading}
        />
        <UiDataRow
          label='Number of Active Loans:'
          value={stats.activeLoans}
          isLoading={isLoading}
        />
        <UiDataRow
          label='Number of Repaid to be Claimed Loans:'
          value={stats.repaidToClaim}
          isLoading={isLoading}
        />
      </UiDataRows>

      {alertOffer && (
        <CardAlert
          variant='accent'
          title='Repayment Available'
          description={`Loan #${truncateAddress(alertOffer.id)} has been repaid. You can now claim the repayment.`}
          actionLabel='Claim Now'
          isDisabled
        />
      )}

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Supply)}>
        Supply
      </UiButton>
    </BalanceCard>
  )
}
