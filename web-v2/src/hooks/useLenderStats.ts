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
  repaidOffer: OfferShort | null
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useLenderStats({
  pollIntervalMs = 30_000,
}: { pollIntervalMs?: number } = {}): UseLenderStatsResult {
  const { isReady, balances, scriptPubkey } = useWallet()
  const script = scriptPubkey ?? ''

  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
    refetch: refetchOverview,
  } = useLenderOverview(script, { refetchInterval: pollIntervalMs })

  const {
    data: offersData,
    isLoading: offersLoading,
    error: offersError,
    refetch: refetchOffers,
  } = useLenderOffers(script, { status: 'repaid', limit: 1 }, { refetchInterval: pollIntervalMs })

  const refetch = useCallback(() => {
    refetchOverview()
    refetchOffers()
  }, [refetchOverview, refetchOffers])

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
    repaidOffer: offersData?.items[0] ?? null,
    isLoading: isReady && (overviewLoading || offersLoading),
    error: overviewError ?? offersError ?? null,
    refetch,
  }
}
