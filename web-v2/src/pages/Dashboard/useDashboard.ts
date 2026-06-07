import { useCallback, useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import {
  useOfferIdsByBorrowerPubkey,
  useOfferIdsByScript,
  useOffers,
  useOffersBatch,
} from '@/api/indexer/hooks'
import { ASSET_ID } from '@/constants/assets'
import { env } from '@/constants/env'
import { DASHBOARD_REFETCH_INTERVAL_MS, REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/lending'
import { useWallet } from '@/providers/wallet/useWallet'
import { getAssetBalance } from '@/utils/balance'
import { type DisplayOffer, toDisplayOffer } from '@/utils/lending'

const NETWORK_ASSETS = ASSET_ID[env.VITE_NETWORK]

export type { DisplayOffer }

export interface DashboardOverview {
  totalCollateral: bigint
  totalBorrowings: bigint
  avgApr: number
  activeLoans: number
  pendingOffers: number
}

export interface BorrowStats {
  lockedCollateral: bigint
  borrowings: bigint
  activeLoans: number
  pendingOffers: number
  toRepay: number
}

export interface SupplyStats {
  suppliedLoans: bigint // total principal_amount across all user's supply offers (USDT)
  interestOutstanding: bigint
  activeLoans: number
  repaidToClaim: number
}

export interface DashboardBorrows {
  balance: bigint
  stats: BorrowStats
  nearExpiryOffers: DisplayOffer[]
  isLoading: boolean
  error: Error | null
}

export interface DashboardSupply {
  balance: bigint
  stats: SupplyStats
  claimableOffers: DisplayOffer[]
  isLoading: boolean
  error: Error | null
}

export function useDashboard() {
  const { connectionStatus, balances, xOnlyPubkey, scriptPubkey } = useWallet()
  const isReady = connectionStatus === 'ready'

  const poll = { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS }

  const offersQuery = useOffers({}, poll)
  const borrowerIdsQuery = useOfferIdsByBorrowerPubkey(xOnlyPubkey ?? '', poll)
  const supplyIdsQuery = useOfferIdsByScript(scriptPubkey ?? '', poll)
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)

  const currentBlockHeight = blockHeightQuery.data ?? 0

  // Overview is computed from the first offers page (see FIXME below).
  const displayOffers = useMemo<DisplayOffer[]>(
    () => (offersQuery.data ?? []).map(offer => toDisplayOffer(offer, currentBlockHeight)),
    [offersQuery.data, currentBlockHeight],
  )

  // The user's own offers are resolved by exact id (batch), not joined against
  // the offers page — otherwise any offer outside page 1 would be silently dropped.
  const borrowerOffersQuery = useOffersBatch(borrowerIdsQuery.data ?? [], poll)
  const supplyOffersQuery = useOffersBatch(supplyIdsQuery.data ?? [], poll)

  const borrowerOffers = useMemo<DisplayOffer[]>(
    () => (borrowerOffersQuery.data ?? []).map(o => toDisplayOffer(o, currentBlockHeight)),
    [borrowerOffersQuery.data, currentBlockHeight],
  )

  const supplyOffers = useMemo<DisplayOffer[]>(
    () => (supplyOffersQuery.data ?? []).map(o => toDisplayOffer(o, currentBlockHeight)),
    [supplyOffersQuery.data, currentBlockHeight],
  )

  // FIXME(backend): computed over one page (`useOffers({})`), not all offers — totals
  // are approximate. Needs a server-side aggregate endpoint (GET /offers/stats).
  const overview = useMemo<DashboardOverview>(() => {
    const active = displayOffers.filter(o => o.status === 'active')
    const totalCollateral = active.reduce((acc, o) => acc + o.collateral_amount, 0n)
    const totalBorrowings = active.reduce((acc, o) => acc + o.principal_amount, 0n)
    const avgApr = active.length
      ? active.reduce((acc, o) => acc + o.interest_rate, 0) / active.length
      : 0
    return {
      totalCollateral,
      totalBorrowings,
      avgApr,
      activeLoans: active.length,
      pendingOffers: displayOffers.filter(o => o.status === 'pending').length,
    }
  }, [displayOffers])

  const lbtcBalance = getAssetBalance(balances, NETWORK_ASSETS.LBTC)
  const usdtBalance = getAssetBalance(balances, NETWORK_ASSETS.USDT)

  const borrows = useMemo<DashboardBorrows>(() => {
    const active = borrowerOffers.filter(o => o.status === 'active')
    const pending = borrowerOffers.filter(o => o.status === 'pending')
    const nearExpiryOffers = active.filter(
      o => o.termLeft > 0 && o.termLeft < REPAYMENT_DUE_THRESHOLD_BLOCKS,
    )
    return {
      balance: lbtcBalance,
      stats: {
        lockedCollateral: active.reduce((acc, o) => acc + o.collateral_amount, 0n),
        borrowings: active.reduce((acc, o) => acc + o.principal_amount, 0n),
        activeLoans: active.length,
        pendingOffers: pending.length,
        toRepay: nearExpiryOffers.length,
      },
      nearExpiryOffers,
      isLoading: isReady && (borrowerIdsQuery.isLoading || borrowerOffersQuery.isLoading),
      error: borrowerIdsQuery.error ?? borrowerOffersQuery.error,
    }
  }, [
    isReady,
    lbtcBalance,
    borrowerOffers,
    borrowerIdsQuery.isLoading,
    borrowerIdsQuery.error,
    borrowerOffersQuery.isLoading,
    borrowerOffersQuery.error,
  ])

  const supply = useMemo<DashboardSupply>(() => {
    const active = supplyOffers.filter(o => o.status === 'active')
    const claimableOffers = supplyOffers.filter(o => o.status === 'repaid')
    return {
      balance: usdtBalance,
      stats: {
        suppliedLoans: supplyOffers.reduce((acc, o) => acc + o.principal_amount, 0n),
        interestOutstanding: active.reduce((acc, o) => acc + o.earn, 0n),
        activeLoans: active.length,
        repaidToClaim: claimableOffers.length,
      },
      claimableOffers,
      isLoading: isReady && (supplyIdsQuery.isLoading || supplyOffersQuery.isLoading),
      error: supplyIdsQuery.error ?? supplyOffersQuery.error,
    }
  }, [
    isReady,
    usdtBalance,
    supplyOffers,
    supplyIdsQuery.isLoading,
    supplyIdsQuery.error,
    supplyOffersQuery.isLoading,
    supplyOffersQuery.error,
  ])

  const offersRefetch = offersQuery.refetch
  const borrowerIdsRefetch = borrowerIdsQuery.refetch
  const supplyIdsRefetch = supplyIdsQuery.refetch
  const borrowerOffersRefetch = borrowerOffersQuery.refetch
  const supplyOffersRefetch = supplyOffersQuery.refetch
  const blockHeightRefetch = blockHeightQuery.refetch

  const refetch = useCallback(() => {
    void offersRefetch()
    void borrowerIdsRefetch()
    void supplyIdsRefetch()
    void borrowerOffersRefetch()
    void supplyOffersRefetch()
    void blockHeightRefetch()
  }, [
    offersRefetch,
    borrowerIdsRefetch,
    supplyIdsRefetch,
    borrowerOffersRefetch,
    supplyOffersRefetch,
    blockHeightRefetch,
  ])

  return {
    overview,
    borrows,
    supply,
    isReady,
    isLoading: isReady && (offersQuery.isLoading || blockHeightQuery.isLoading),
    refetch,
  }
}
