import { useCallback } from 'react'

import { useLenderOverview } from '@/api/indexer/hooks'
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
  pendingBalance: bigint
  stats: LenderStats
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

export function useLenderStats({
  pollIntervalMs = 30_000,
}: { pollIntervalMs?: number } = {}): UseLenderStatsResult {
  const { isReady, balances, confirmedBalances, scriptPubkey } = useWallet()
  const script = scriptPubkey ?? ''

  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
    refetch: refetchOverview,
  } = useLenderOverview(script, { refetchInterval: pollIntervalMs })

  const refetch = useCallback(() => {
    refetchOverview()
  }, [refetchOverview])

  const totalBalance = BigInt(balances[NETWORK_CONFIG.principalAsset.id] ?? 0)
  const balance = BigInt(confirmedBalances[NETWORK_CONFIG.principalAsset.id] ?? 0)

  return {
    balance,
    pendingBalance: totalBalance - balance,
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
    isLoading: isReady && overviewLoading,
    error: overviewError ?? null,
    refetch,
  }
}
