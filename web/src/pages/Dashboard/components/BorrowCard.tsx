import { Skeleton } from '@heroui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useAllBorrowerOffers } from '@/api/indexer/hooks'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import ChecksIcon from '@/components/icons/ChecksIcon'
import ClockIcon from '@/components/icons/ClockIcon'
import CoinsIcon from '@/components/icons/CoinsIcon'
import FileTextIcon from '@/components/icons/FileTextIcon'
import LockIcon from '@/components/icons/LockIcon'
import PendingBalanceBadge from '@/components/PendingBalanceBadge'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatUsd } from '@/utils/format'
import { buildOfferNotifications } from '@/utils/notifications'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

import { AssetAmount } from './AssetAmount'
import CardNotifications from './CardNotifications'
import { DataRow } from './DataRow'

export function BorrowCard() {
  const navigate = useNavigate()
  const { confirmedBalances, pendingBalances, scriptPubkey } = useWallet()
  const { stats, isLoading, error, refetch } = useBorrowerStats()
  const { collateralUnit, formatCollateralAmount, formatCollateralDisplay, formatPrincipalAmount } =
    useFormatAmount()
  const offersQuery = useAllBorrowerOffers(
    scriptPubkey ?? '',
    { status: ['active', 'pending', 'liquidated'] },
    { refetchInterval: 30_000 },
  )
  const { data: currentBlockHeight } = useBlockHeight()
  const { pendingTxs } = usePendingTransactions()
  const collateralPriceUsd = useAssetPriceUsd(NETWORK_CONFIG.collateralAsset.id)

  const balance = BigInt(confirmedBalances[NETWORK_CONFIG.collateralAsset.id] ?? 0)
  const pendingBalance = BigInt(pendingBalances[NETWORK_CONFIG.collateralAsset.id] ?? 0)
  const balanceUsd = formatUsd(balance, NETWORK_CONFIG.collateralAsset.decimals, collateralPriceUsd)
  const notifications = buildOfferNotifications(
    offersQuery.data ?? [],
    scriptPubkey,
    currentBlockHeight,
  ).filter(n => !getOfferPendingTx(n.offer.id, pendingTxs))

  useEffect(() => {
    if (error) ErrorHandler.processWithRetry(error, refetch, 'Failed to load your borrows.')
  }, [error, refetch])

  return (
    <section className='bg-surface-secondary flex flex-1 flex-col gap-4 rounded-2xl p-4 sm:p-6'>
      <header className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground'>
            <CoinsIcon className='size-5' />
          </span>
          <h3 className='text-h3'>Your Borrows</h3>
        </div>
        <p className='text-muted text-h4'>Available Balance {collateralUnit}</p>
      </header>

      {isLoading ? (
        <Skeleton className='h-8 w-32 rounded-lg' />
      ) : (
        <div className='flex flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <p className='text-display'>
              <AssetAmount value={formatCollateralAmount(balance)} unit={collateralUnit} />
            </p>
            {pendingBalance > 0n && (
              <PendingBalanceBadge
                label={formatCollateralAmount(pendingBalance)}
                tooltip={`${formatCollateralAmount(pendingBalance)} ${collateralUnit} is unconfirmed and on the way. It will be spendable once the transaction confirms.`}
              />
            )}
          </div>
          <span className='text-muted text-xs'>{balanceUsd ?? '—'}</span>
        </div>
      )}

      <div className='bg-surface flex flex-col gap-2 rounded-lg p-4 sm:p-6'>
        <DataRow
          icon={<LockIcon className='size-5 shrink-0' />}
          label='Total Locked Collateral:'
          value={formatCollateralDisplay(stats.lockedCollateral)}
          isLoading={isLoading}
        />
        <DataRow
          icon={<FileTextIcon className='size-5 shrink-0' />}
          label='Borrowings:'
          value={formatPrincipalAmount(stats.borrowings)}
          isLoading={isLoading}
        />
        <DataRow
          icon={<ChecksIcon className='size-5 shrink-0' />}
          label='Active Loans:'
          value={stats.activeLoans}
          isLoading={isLoading}
        />
        <DataRow
          icon={<ClockIcon className='size-5 shrink-0' />}
          label='Pending Offers:'
          value={stats.pendingOffers}
          isLoading={isLoading}
        />
      </div>

      <CardNotifications notifications={notifications} title='Borrower Notifications' />

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Borrow)}>
        Borrow
      </UiButton>
    </section>
  )
}
