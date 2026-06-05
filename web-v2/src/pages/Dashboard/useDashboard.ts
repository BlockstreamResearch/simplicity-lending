import { useCallback, useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOfferIdsByBorrowerPubkey, useOfferIdsByScript, useOffers } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import type { DisplayStatus } from '@/components/ui/OfferStatusBadge'
import { ASSET_ID } from '@/constants/assets'
import { env } from '@/constants/env'
import { DASHBOARD_REFETCH_INTERVAL_MS, REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/lending'
import { MOCK_OFFERS } from '@/mocks/offers'
import { useWallet } from '@/providers/wallet/useWallet'
import { getAssetBalance } from '@/utils/balance'
import { calcInterest } from '@/utils/lending'

const NETWORK_ASSETS = ASSET_ID[env.VITE_NETWORK]

export interface DisplayOffer extends OfferShort {
  termLeft: number
  displayStatus: DisplayStatus
  earn: bigint // total interest, precomputed for sorting
}

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

  const offersQuery = useOffers({}, { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS })
  const borrowerIdsQuery = useOfferIdsByBorrowerPubkey(xOnlyPubkey ?? '')
  const supplyIdsQuery = useOfferIdsByScript(scriptPubkey ?? '')
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)

  const currentBlockHeight = blockHeightQuery.data ?? 0

  const allOffers = useMemo(
    () => (env.DEV ? MOCK_OFFERS : (offersQuery.data ?? [])),
    [offersQuery.data],
  )

  const displayOffers = useMemo<DisplayOffer[]>(
    () =>
      allOffers.map(offer => {
        const termLeft = offer.loan_expiration_time - currentBlockHeight
        const displayStatus = offer.status === 'pending' && termLeft <= 0 ? 'expired' : offer.status
        return {
          ...offer,
          termLeft,
          displayStatus,
          earn: calcInterest(offer.principal_amount, offer.interest_rate),
        }
      }),
    [allOffers, currentBlockHeight],
  )

  const offerById = useMemo(() => {
    const map = new Map<string, DisplayOffer>()
    for (const offer of displayOffers) map.set(offer.id, offer)
    return map
  }, [displayOffers])

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
    const ids = borrowerIdsQuery.data ?? []
    const mine = ids.map(id => offerById.get(id)).filter((o): o is DisplayOffer => !!o)
    const active = mine.filter(o => o.status === 'active')
    const pending = mine.filter(o => o.status === 'pending')
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
      isLoading: isReady && borrowerIdsQuery.isLoading,
      error: borrowerIdsQuery.error,
    }
  }, [
    isReady,
    lbtcBalance,
    borrowerIdsQuery.data,
    borrowerIdsQuery.isLoading,
    borrowerIdsQuery.error,
    offerById,
  ])

  const supply = useMemo<DashboardSupply>(() => {
    const ids = supplyIdsQuery.data ?? []
    const mine = ids.map(id => offerById.get(id)).filter((o): o is DisplayOffer => !!o)
    const active = mine.filter(o => o.status === 'active')
    const claimableOffers = mine.filter(o => o.status === 'repaid')
    return {
      balance: usdtBalance,
      stats: {
        suppliedLoans: mine.reduce((acc, o) => acc + o.principal_amount, 0n),
        interestOutstanding: active.reduce((acc, o) => acc + o.earn, 0n),
        activeLoans: active.length,
        repaidToClaim: claimableOffers.length,
      },
      claimableOffers,
      isLoading: isReady && supplyIdsQuery.isLoading,
      error: supplyIdsQuery.error,
    }
  }, [
    isReady,
    usdtBalance,
    supplyIdsQuery.data,
    supplyIdsQuery.isLoading,
    supplyIdsQuery.error,
    offerById,
  ])

  const offersRefetch = offersQuery.refetch
  const borrowerIdsRefetch = borrowerIdsQuery.refetch
  const supplyIdsRefetch = supplyIdsQuery.refetch
  const blockHeightRefetch = blockHeightQuery.refetch

  const refetch = useCallback(() => {
    void offersRefetch()
    void borrowerIdsRefetch()
    void supplyIdsRefetch()
    void blockHeightRefetch()
  }, [offersRefetch, borrowerIdsRefetch, supplyIdsRefetch, blockHeightRefetch])

  return {
    overview,
    borrows,
    supply,
    isReady,
    isLoading: isReady && (offersQuery.isLoading || blockHeightQuery.isLoading),
    refetch,
  }
}
