import { useCallback, useMemo } from 'react'

import { useOfferIdsByScript, useOffersBatch } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { LENDING } from '@/constants/config'
import { DASHBOARD_REFETCH_INTERVAL_MS } from '@/constants/dashboard'
import { useWallet } from '@/providers/wallet/useWallet'
import { calcInterest } from '@/utils/offers'

export interface SupplyStats {
  suppliedLoans: bigint // total principal_amount across all the user's supply offers
  interestOutstanding: bigint
  activeLoans: number
  repaidToClaim: number
}

export interface DashboardSupply {
  balance: bigint
  stats: SupplyStats
  claimableOffers: OfferShort[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useSupply(): DashboardSupply {
  const { connectionStatus, balances, scriptPubkey } = useWallet()
  const isReady = connectionStatus === 'ready'

  const poll = { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS }
  const idsQuery = useOfferIdsByScript(scriptPubkey ?? '', poll)
  const offersQuery = useOffersBatch(idsQuery.data ?? [], poll)

  const balance = BigInt(balances[LENDING.principalAssetId] ?? 0)

  const idsRefetch = idsQuery.refetch
  const offersRefetch = offersQuery.refetch
  const refetch = useCallback(() => {
    void idsRefetch()
    void offersRefetch()
  }, [idsRefetch, offersRefetch])

  return useMemo<DashboardSupply>(() => {
    const offers = offersQuery.data ?? []
    const active = offers.filter(o => o.status === 'active')
    const claimableOffers = offers.filter(o => o.status === 'repaid')
    return {
      balance,
      stats: {
        suppliedLoans: offers.reduce((acc, o) => acc + o.principal_amount, 0n),
        interestOutstanding: active.reduce(
          (acc, o) => acc + calcInterest(o.principal_amount, o.interest_rate),
          0n,
        ),
        activeLoans: active.length,
        repaidToClaim: claimableOffers.length,
      },
      claimableOffers,
      isLoading: isReady && (idsQuery.isLoading || offersQuery.isLoading),
      error: idsQuery.error ?? offersQuery.error,
      refetch,
    }
  }, [
    isReady,
    balance,
    offersQuery.data,
    idsQuery.isLoading,
    idsQuery.error,
    offersQuery.isLoading,
    offersQuery.error,
    refetch,
  ])
}
