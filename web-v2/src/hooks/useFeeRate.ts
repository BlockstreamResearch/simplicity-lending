import { useQuery } from '@tanstack/react-query'

import { FALLBACK_FEE_RATE_SAT_PER_KVB, fetchFeeRateSatPerKvb } from '@/api/esplora/fee'

export function useFeeRateSatPerKvb(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ['fee-rate-sat-per-kvb'],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchFeeRateSatPerKvb(),
  })
  return data ?? FALLBACK_FEE_RATE_SAT_PER_KVB
}
