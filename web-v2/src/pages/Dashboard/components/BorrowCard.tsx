import { Skeleton } from '@heroui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useBorrowerOffers } from '@/api/indexer/hooks'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import CoinsIcon from '@/components/icons/CoinsIcon'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/offers'
import { RoutePath } from '@/constants/routes'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { useWallet } from '@/providers/wallet/useWallet'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatAmount, formatUsd, truncateAddress } from '@/utils/format'
import { getOfferTermLeft } from '@/utils/offers'
import {
  formatPolicyAssetAmount,
  formatPolicyAssetDisplay,
  getPolicyAssetUnit,
} from '@/utils/policyAssetDenomination'

import { AssetAmount } from './AssetAmount'
import CardAlert from './CardAlert'
import { DataRow } from './DataRow'

export function BorrowCard() {
  const navigate = useNavigate()
  const { balances, scriptPubkey } = useWallet()
  const { stats, isLoading, error, refetch } = useBorrowerStats()
  const { denomination } = useAssetDenomination()
  const offersQuery = useBorrowerOffers(scriptPubkey ?? '', { status: 'active', limit: 50 })
  const { data: currentBlockHeight } = useBlockHeight()
  const collateralPriceUsd = useAssetPriceUsd(NETWORK_CONFIG.collateralAsset.id)
  const collateralUnit = getPolicyAssetUnit(denomination, NETWORK_CONFIG.collateralAsset)

  const balance = BigInt(balances[NETWORK_CONFIG.collateralAsset.id] ?? 0)
  const balanceUsd = formatUsd(balance, NETWORK_CONFIG.collateralAsset.decimals, collateralPriceUsd)
  const activeOffers = offersQuery.data?.items ?? []
  const nearExpiryOffers = activeOffers.filter(o => {
    const termLeft = getOfferTermLeft(o, currentBlockHeight)
    return termLeft > 0 && termLeft < REPAYMENT_DUE_THRESHOLD_BLOCKS
  })
  const alertOffer = nearExpiryOffers[0]

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
        <p className='text-muted text-h4'>Complete Balance {collateralUnit}</p>
      </header>

      {isLoading ? (
        <Skeleton className='h-8 w-32 rounded-lg' />
      ) : (
        <div className='flex flex-col gap-1'>
          <p className='text-display'>
            <AssetAmount
              value={formatPolicyAssetAmount(balance, denomination, NETWORK_CONFIG.collateralAsset)}
              unit={collateralUnit}
            />
          </p>
          <span className='text-muted text-xs'>{balanceUsd ?? '—'}</span>
        </div>
      )}

      <div className='bg-surface flex flex-col gap-3 rounded-lg p-4 sm:p-6'>
        <DataRow
          label='User Total Locked Collateral:'
          value={formatPolicyAssetDisplay(
            stats.lockedCollateral,
            denomination,
            NETWORK_CONFIG.collateralAsset,
          )}
          isLoading={isLoading}
        />
        <DataRow
          label='Borrowings:'
          value={`${formatAmount(stats.borrowings, NETWORK_CONFIG.principalAsset.decimals)} ${NETWORK_CONFIG.principalAsset.symbol}`}
          isLoading={isLoading}
        />
        <DataRow label='Number of active loans:' value={stats.activeLoans} isLoading={isLoading} />
        <DataRow
          label='Number of pending offers:'
          value={stats.pendingOffers}
          isLoading={isLoading}
        />
      </div>

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
    </section>
  )
}
