import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { WalletAssetBalance, WalletCapabilities, WalletUtxo } from '@/lib/wallet/types'

import { STALE_TIME_MS } from '../staleTime'
import { fetchWalletBalances, fetchWalletUtxos } from './methods'
import { walletQueryKeys } from './queryKeys'

/** What the wallet says this account holds of each named asset, keyed by asset id. */
export function useWalletBalances(
  capabilities: WalletCapabilities,
  account: string | null,
  assetIds: readonly string[],
): UseQueryResult<Record<string, WalletAssetBalance>> {
  return useQuery({
    queryKey: walletQueryKeys.balances(account, assetIds),
    queryFn: () => fetchWalletBalances(capabilities, assetIds),
    staleTime: STALE_TIME_MS.realtime,
    enabled: account !== null && assetIds.length > 0,
  })
}

/** The outputs the wallet will spend for one asset. */
export function useWalletUtxos(
  capabilities: WalletCapabilities,
  account: string | null,
  assetId: string,
  enabled = true,
): UseQueryResult<WalletUtxo[]> {
  return useQuery({
    queryKey: walletQueryKeys.utxos(account, assetId),
    queryFn: () => fetchWalletUtxos(capabilities, assetId),
    staleTime: STALE_TIME_MS.realtime,
    enabled: enabled && account !== null && assetId !== '',
  })
}
