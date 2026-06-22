import { useCallback } from 'react'

import { useLenderOffers, useLenderOverview } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'
import { findAssetAmount } from '@/utils/offers'

export interface LenderStats {
  suppliedLoans: bigint
  interestOutstanding: bigint
  activeLoans: number
  repaidToClaim: number
}

export interface UseLenderStatsResult {
  balance: bigint
  stats: LenderStats
  claimableOffers: OfferShort[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useLenderStats({
  pollIntervalMs = 30_000,
}: { pollIntervalMs?: number } = {}): UseLenderStatsResult {
  const { isReady, balances, scriptPubkey } = useWallet()
  const script = scriptPubkey ?? ''

  const overviewQuery = useLenderOverview(script, { refetchInterval: pollIntervalMs })
  const offersQuery = useLenderOffers(script, { limit: 100 }, { refetchInterval: pollIntervalMs })

  const refetch = useCallback(() => {
    overviewQuery.refetch()
    offersQuery.refetch()
  }, [overviewQuery, offersQuery])

  const overview = overviewQuery.data
  const offers = offersQuery.data?.items ?? []
  const claimableOffers = offers.filter(o => o.status === 'repaid')
  const balance = BigInt(balances[NETWORK_CONFIG.principalAsset.id] ?? 0)

  return {
    balance,
    stats: {
      suppliedLoans: overview
        ? findAssetAmount(overview.supplied_loans, NETWORK_CONFIG.principalAsset.id)
        : 0n,
      interestOutstanding: overview
        ? findAssetAmount(overview.interest_outstanding, NETWORK_CONFIG.principalAsset.id)
        : 0n,
      activeLoans: overview?.active_loans ?? 0,
      repaidToClaim: overview?.to_be_claimed ?? 0,
    },
    claimableOffers,
    isLoading: isReady && (overviewQuery.isLoading || offersQuery.isLoading),
    error: overviewQuery.error ?? offersQuery.error ?? null,
    refetch,
  }
}
