import { useCallback, useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOfferIdsByBorrowerPubkey, useOffersBatch } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/offers'
import { useWallet } from '@/providers/wallet/useWallet'
import { getOfferTermLeft } from '@/utils/offers'

import { DASHBOARD_REFETCH_INTERVAL_MS } from '../constants'

export interface BorrowStats {
  lockedCollateral: bigint
  borrowings: bigint
  activeLoans: number
  pendingOffers: number
  toRepay: number
  averageApr: number
}

export interface DashboardBorrows {
  balance: bigint
  stats: BorrowStats
  offers: OfferShort[]
  currentBlockHeight: number
  nearExpiryOffers: OfferShort[]
  isLoading: boolean
  error: Error | null
  // Wallet can't expose an x-only pubkey → borrows can't be looked up (≠ "no borrows").
  unsupported: boolean
  refetch: () => void
}

export function useBorrows(): DashboardBorrows {
  const { isReady, balances, xOnlyPubkey } = useWallet()

  const poll = { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS }
  const idsQuery = useOfferIdsByBorrowerPubkey(xOnlyPubkey ?? '', poll)
  const offersQuery = useOffersBatch(idsQuery.data ?? [], poll)
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)
  const currentBlockHeight = blockHeightQuery.data ?? 0

  // TODO: fetch balance from indexer when it provides an endpoint
  const balance = BigInt(balances[NETWORK_CONFIG.collateralAsset.id] ?? 0)

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
    const totalPrincipal = active.reduce((acc, o) => acc + Number(o.principal_amount), 0)
    const averageApr =
      totalPrincipal > 0
        ? active.reduce((acc, o) => {
            const principal = Number(o.principal_amount)
            return acc + principal * o.interest_rate
          }, 0) / totalPrincipal
        : 0
    return {
      balance,
      stats: {
        lockedCollateral: active.reduce((acc, o) => acc + o.collateral_amount, 0n),
        borrowings: active.reduce((acc, o) => acc + o.principal_amount, 0n),
        activeLoans: active.length,
        pendingOffers: pending.length,
        toRepay: nearExpiryOffers.length,
        averageApr,
      },
      offers,
      currentBlockHeight,
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
