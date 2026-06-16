import { useCallback, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useBorrowerDashboard, useFactories } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { computeApr, findAssetAmount, getOfferTermLeft } from '@/utils/offers'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/offers'
import { type FactoryState, prepareFactory } from '@/utils/factory'
import { BORROW_PAGE_SIZE } from '@/pages/Dashboard/constants'
import { useWallet } from '@/providers/wallet/useWallet'

export interface BorrowStats {
  lockedCollateral: bigint
  borrowings: bigint
  activeLoans: number
  pendingOffers: number
  toRepay: number
  averageApr: number
}

export interface UseBorrowsResult {
  balance: bigint
  stats: BorrowStats
  offers: OfferShort[]
  totalOffers: number
  page: number
  setPage: (page: number) => void
  currentBlockHeight: number
  nearExpiryOffers: OfferShort[]
  factory: FactoryState | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useBorrows(): UseBorrowsResult {
  const { isReady, balances, scriptPubkey } = useWallet()
  const [page, setPage] = useState(1)
  const offset = (page - 1) * BORROW_PAGE_SIZE

  const dashboardQuery = useBorrowerDashboard(scriptPubkey ?? '', {
    limit: BORROW_PAGE_SIZE,
    offset,
  })
  const factoriesQuery = useFactories(scriptPubkey ?? '')
  const blockHeightQuery = useBlockHeight()

  const currentBlockHeight = blockHeightQuery.data ?? 0
  const collateralBalance = BigInt(balances[NETWORK_CONFIG.collateralAsset.id] ?? 0)

  const refetch = useCallback(() => {
    void dashboardQuery.refetch()
    void factoriesQuery.refetch()
    void blockHeightQuery.refetch()
  }, [dashboardQuery, factoriesQuery, blockHeightQuery])

  const overview = dashboardQuery.data?.overview
  const offers = dashboardQuery.data?.offers.items ?? []
  const totalOffers = dashboardQuery.data?.offers.total ?? 0
  const factory = factoriesQuery.data?.[0] ? prepareFactory(factoriesQuery.data[0]) : null

  const activeOffers = offers.filter(o => o.status === 'active')
  const nearExpiryOffers = activeOffers.filter(o => {
    const termLeft = getOfferTermLeft(o, currentBlockHeight)
    return termLeft > 0 && termLeft < REPAYMENT_DUE_THRESHOLD_BLOCKS
  })
  const activeWithValidDuration = activeOffers.filter(
    o => o.loan_expiration_time - o.created_at_height > 0,
  )
  const validPrincipal = activeWithValidDuration.reduce(
    (acc, o) => acc + Number(o.principal_amount),
    0,
  )
  // TODO: Get average APR from the backend.
  const averageApr =
    validPrincipal > 0
      ? activeWithValidDuration.reduce(
          (acc, o) =>
            acc +
            Number(o.principal_amount) *
              computeApr(o.interest_rate, o.loan_expiration_time - o.created_at_height),
          0,
        ) / validPrincipal
      : 0

  return {
    balance: collateralBalance,
    stats: {
      lockedCollateral: overview
        ? findAssetAmount(overview.collateral_locked, NETWORK_CONFIG.collateralAsset.id)
        : 0n,
      borrowings: overview
        ? findAssetAmount(overview.borrowings, NETWORK_CONFIG.principalAsset.id)
        : 0n,
      activeLoans: overview?.active_loans ?? 0,
      pendingOffers: overview?.pending_offers ?? 0,
      toRepay: nearExpiryOffers.length,
      averageApr,
    },
    offers,
    totalOffers,
    page,
    setPage,
    currentBlockHeight,
    nearExpiryOffers,
    factory,
    isLoading:
      isReady &&
      (dashboardQuery.isLoading || factoriesQuery.isLoading || blockHeightQuery.isLoading),
    error: dashboardQuery.error ?? factoriesQuery.error ?? blockHeightQuery.error,
    refetch,
  }
}
