import { Skeleton } from '@heroui/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useBorrowerOffers } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import CoinsIcon from '@/components/icons/CoinsIcon'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/offers'
import { RoutePath } from '@/constants/routes'
import { useBorrowerStats } from '@/hooks/useBorrowerStats'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ErrorHandler } from '@/utils/errorHandler'
import { formatUsd, truncateAddress } from '@/utils/format'
import { resolveOfferAction } from '@/utils/offerActions'
import { getOfferTermLeft } from '@/utils/offers'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

import { AssetAmount } from './AssetAmount'
import CardAlert from './CardAlert'
import { DataRow } from './DataRow'

export function BorrowCard() {
  const navigate = useNavigate()
  const { balances, scriptPubkey } = useWallet()
  const { stats, isLoading, error, refetch } = useBorrowerStats()
  const { collateralUnit, formatCollateralAmount, formatCollateralDisplay, formatPrincipalAmount } =
    useFormatAmount()
  const offersQuery = useBorrowerOffers(scriptPubkey ?? '', { status: 'active', limit: 50 })
  const { data: currentBlockHeight } = useBlockHeight()
  const { pendingTxs } = usePendingTransactions()
  const collateralPriceUsd = useAssetPriceUsd(NETWORK_CONFIG.collateralAsset.id)

  const balance = BigInt(balances[NETWORK_CONFIG.collateralAsset.id] ?? 0)
  const balanceUsd = formatUsd(balance, NETWORK_CONFIG.collateralAsset.decimals, collateralPriceUsd)
  const activeOffers = offersQuery.data?.items ?? []
  const repayDueOffer = activeOffers.find(o => {
    const termLeft = getOfferTermLeft(o, currentBlockHeight)
    return (
      !getOfferPendingTx(o.id, pendingTxs) &&
      resolveOfferAction(o, scriptPubkey, currentBlockHeight) === 'repay' &&
      termLeft > 0 &&
      termLeft < REPAYMENT_DUE_THRESHOLD_BLOCKS
    )
  })
  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)

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
            <AssetAmount value={formatCollateralAmount(balance)} unit={collateralUnit} />
          </p>
          <span className='text-muted text-xs'>{balanceUsd ?? '—'}</span>
        </div>
      )}

      <div className='bg-surface flex flex-col gap-3 rounded-lg p-4 sm:p-6'>
        <DataRow
          label='User Total Locked Collateral:'
          value={formatCollateralDisplay(stats.lockedCollateral)}
          isLoading={isLoading}
        />
        <DataRow
          label='Borrowings:'
          value={formatPrincipalAmount(stats.borrowings)}
          isLoading={isLoading}
        />
        <DataRow label='Number of active loans:' value={stats.activeLoans} isLoading={isLoading} />
        <DataRow
          label='Number of pending offers:'
          value={stats.pendingOffers}
          isLoading={isLoading}
        />
      </div>

      {repayDueOffer && (
        <CardAlert
          variant='warning'
          title='Repayment Due Soon'
          description={`Loan #${truncateAddress(repayDueOffer.id)} Nearing Deadline. Repay to Avoid Liquidation.`}
          actionLabel='Repay Now'
          onAction={() => setSelectedOffer(repayDueOffer)}
        />
      )}

      <UiButton className='self-start' variant='primary' onPress={() => navigate(RoutePath.Borrow)}>
        Borrow
      </UiButton>

      <OfferActionModal
        offer={selectedOffer}
        isOpen={selectedOffer !== null}
        onClose={() => setSelectedOffer(null)}
        onSuccess={() => {
          setSelectedOffer(null)
          refetch()
          offersQuery.refetch()
        }}
      />
    </section>
  )
}
