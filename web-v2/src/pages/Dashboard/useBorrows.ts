import { useCallback, useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOfferIdsByBorrowerPubkey, useOffersBatch } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { LENDING } from '@/constants/config'
import { DASHBOARD_REFETCH_INTERVAL_MS } from '@/constants/dashboard'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/offers'
import { useWallet } from '@/providers/wallet/useWallet'
import { getOfferTermLeft } from '@/utils/offers'

export interface BorrowStats {
  lockedCollateral: bigint
  borrowings: bigint
  activeLoans: number
  pendingOffers: number
  toRepay: number
}

export interface DashboardBorrows {
  balance: bigint
  stats: BorrowStats
  nearExpiryOffers: OfferShort[]
  isLoading: boolean
  error: Error | null
  // Wallet can't expose an x-only pubkey → borrows can't be looked up (≠ "no borrows").
  unsupported: boolean
  refetch: () => void
}

export function useBorrows(): DashboardBorrows {
  const { connectionStatus, balances, xOnlyPubkey } = useWallet()
  const isReady = connectionStatus === 'ready'

  const poll = { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS }
  const idsQuery = useOfferIdsByBorrowerPubkey(xOnlyPubkey ?? '', poll)
  const offersQuery = useOffersBatch(idsQuery.data ?? [], poll)
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)
  const currentBlockHeight = blockHeightQuery.data ?? 0

  const balance = BigInt(balances[LENDING.collateralAssetId] ?? 0)

  const idsRefetch = idsQuery.refetch
  const offersRefetch = offersQuery.refetch
  const blockHeightRefetch = blockHeightQuery.refetch
  const refetch = useCallback(() => {
    void idsRefetch()
    void offersRefetch()
    void blockHeightRefetch()
  }, [idsRefetch, offersRefetch, blockHeightRefetch])

  return useMemo<DashboardBorrows>(() => {
    const offers = offersQuery.data ?? []
    const active = offers.filter(o => o.status === 'active')
    const pending = offers.filter(o => o.status === 'pending')
    const nearExpiryOffers = active.filter(o => {
      const termLeft = getOfferTermLeft(o, currentBlockHeight)
      return termLeft > 0 && termLeft < REPAYMENT_DUE_THRESHOLD_BLOCKS
    })
    return {
      balance,
      stats: {
        lockedCollateral: active.reduce((acc, o) => acc + o.collateral_amount, 0n),
        borrowings: active.reduce((acc, o) => acc + o.principal_amount, 0n),
        activeLoans: active.length,
        pendingOffers: pending.length,
        toRepay: nearExpiryOffers.length,
      },
      nearExpiryOffers,
      isLoading: isReady && (idsQuery.isLoading || offersQuery.isLoading),
      error: idsQuery.error ?? offersQuery.error,
      unsupported: isReady && !xOnlyPubkey,
      refetch,
    }
  }, [
    isReady,
    xOnlyPubkey,
    balance,
    currentBlockHeight,
    offersQuery.data,
    idsQuery.isLoading,
    idsQuery.error,
    offersQuery.isLoading,
    offersQuery.error,
    refetch,
  ])
}
