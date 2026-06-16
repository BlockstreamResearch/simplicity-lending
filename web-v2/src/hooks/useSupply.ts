import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useOfferIdsByScript } from '@/api/indexer/hooks'
import { fetchOffer } from '@/api/indexer/methods'
import { offersQueryKeys } from '@/api/indexer/queryKeys'
import type { OfferDetails } from '@/api/indexer/schemas'
import { STALE_TIME_MS } from '@/api/staleTime'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { DASHBOARD_REFETCH_INTERVAL_MS } from '@/pages/Dashboard/constants'
import { useWallet } from '@/providers/wallet/useWallet'
import { calcInterest } from '@/utils/offers'

export interface SupplyStats {
  suppliedLoans: bigint
  interestOutstanding: bigint
  activeLoans: number
  repaidToClaim: number
}

export interface UseSupplyResult {
  balance: bigint
  stats: SupplyStats
  claimableOffers: OfferDetails[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useSupply(): UseSupplyResult {
  const { isReady, balances, scriptPubkey } = useWallet()
  const queryClient = useQueryClient()

  const poll = { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS }
  const idsQuery = useOfferIdsByScript(scriptPubkey ?? '', poll)

  const offerQueries = useQueries({
    queries: (idsQuery.data ?? []).map(id => ({
      queryKey: offersQueryKeys.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchOffer(id, { signal }),
      staleTime: STALE_TIME_MS.realtime,
      refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS,
    })),
  })

  const refetch = useCallback(() => {
    void idsQuery.refetch()
    void queryClient.refetchQueries({ queryKey: offersQueryKeys.all })
  }, [idsQuery, queryClient])

  const balance = BigInt(balances[NETWORK_CONFIG.principalAsset.id] ?? 0)
  const offers = offerQueries.flatMap(q => (q.data ? [q.data] : []))
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
    isLoading: isReady && (idsQuery.isLoading || offerQueries.some(q => q.isLoading)),
    error: idsQuery.error ?? offerQueries.find(q => q.error)?.error ?? null,
    refetch,
  }
}
