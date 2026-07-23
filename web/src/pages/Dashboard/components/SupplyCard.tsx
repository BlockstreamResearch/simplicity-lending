import { Skeleton } from '@heroui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useAllLenderOffers } from '@/api/indexer/hooks'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import ArrowSquareUpIcon from '@/components/icons/ArrowSquareUpIcon'
import ChecksIcon from '@/components/icons/ChecksIcon'
import HandCoinsIcon from '@/components/icons/HandCoinsIcon'
import LockIcon from '@/components/icons/LockIcon'
import PercentIcon from '@/components/icons/PercentIcon'
import PendingBalanceBadge from '@/components/PendingBalanceBadge'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { useLenderStats } from '@/hooks/useLenderStats'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatAmount, formatUsd } from '@/utils/format'
import { buildOfferNotifications } from '@/utils/notifications'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

import { AssetAmount } from './AssetAmount'
import CardNotifications from './CardNotifications'
import { DataRow } from './DataRow'

export function SupplyCard() {
  const navigate = useNavigate()
  const { scriptPubkey } = useWallet()
  const { balance, pendingBalance, stats, isLoading, error, refetch } = useLenderStats()
  const principalPriceUsd = useAssetPriceUsd(NETWORK_CONFIG.principalAsset.id)
  const balanceUsd = formatUsd(balance, NETWORK_CONFIG.principalAsset.decimals, principalPriceUsd)
  const { pendingTxs } = usePendingTransactions()
  const { data: currentBlockHeight } = useBlockHeight()
  const offersQuery = useAllLenderOffers(scriptPubkey ?? '', { status: ['active', 'repaid'] })

  const notifications = buildOfferNotifications(
    offersQuery.data ?? [],
    scriptPubkey,
    currentBlockHeight,
  ).filter(n => !getOfferPendingTx(n.offer.id, pendingTxs))

  useEffect(() => {
    if (error) ErrorHandler.processWithRetry(error, refetch, 'Failed to load your supply.')
  }, [error, refetch])

  return (
    <section className='bg-surface-secondary flex flex-1 flex-col gap-4 rounded-2xl p-4 sm:p-6'>
      <header className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground'>
            <ArrowSquareUpIcon className='size-5' />
          </span>
          <h3 className='text-h3'>Your Supply</h3>
        </div>
        <p className='text-muted text-h4'>
          Available Balance {NETWORK_CONFIG.principalAsset.symbol}
        </p>
      </header>

      {isLoading ? (
        <Skeleton className='h-8 w-32 rounded-lg' />
      ) : (
        <div className='flex flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <p className='text-display'>
              <AssetAmount
                value={formatAmount(balance, NETWORK_CONFIG.principalAsset.decimals)}
                unit={NETWORK_CONFIG.principalAsset.symbol}
              />
            </p>
            {pendingBalance > 0n && (
              <PendingBalanceBadge
                label={`${formatAmount(pendingBalance, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol}`}
                tooltip={`${formatAmount(pendingBalance, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol} is unconfirmed and on the way. It will be spendable once the transaction confirms.`}
              />
            )}
          </div>
          <span className='text-muted text-xs'>{balanceUsd ?? '—'}</span>
        </div>
      )}

      <div className='bg-surface flex flex-col gap-2 rounded-lg p-4 sm:p-6'>
        <DataRow
          icon={<LockIcon className='size-5 shrink-0' />}
          label='Supplied Loans:'
          value={`${formatAmount(stats.suppliedLoans, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol}`}
          isLoading={isLoading}
        />
        <DataRow
          icon={<PercentIcon className='size-5 shrink-0' />}
          label='Interest Outstanding:'
          value={`${formatAmount(stats.interestOutstanding, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol}`}
          isLoading={isLoading}
        />
        <DataRow
          icon={<ChecksIcon className='size-5 shrink-0' />}
          label='Active Loans:'
          value={stats.activeLoans}
          isLoading={isLoading}
        />
        <DataRow
          icon={<HandCoinsIcon className='size-5 shrink-0' />}
          label='Claimable Loans:'
          value={stats.repaidToClaim}
          isLoading={isLoading}
        />
      </div>

      <CardNotifications notifications={notifications} title='Lender Notifications' />

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Supply)}>
        Supply
      </UiButton>
    </section>
  )
}
