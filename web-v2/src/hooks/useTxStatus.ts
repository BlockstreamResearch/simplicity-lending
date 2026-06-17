import { useQuery } from '@tanstack/react-query'

import { fetchLatestBlockHeight, fetchTxStatus } from '@/api/esplora/methods'

const CONFIRMED_THRESHOLD = 1
const FINALIZED_THRESHOLD = 2

export type TxStatus = 'processing' | 'confirmed' | 'finalized'

export function useTxStatus(txid?: string | null, pollIntervalMs = 15_000): TxStatus | null {
  const { data } = useQuery({
    queryKey: ['tx-status', txid],
    enabled: Boolean(txid),
    refetchInterval: query => (query.state.data === 'finalized' ? false : pollIntervalMs),
    queryFn: async (): Promise<TxStatus> => {
      const status = await fetchTxStatus(txid as string)

      if (!status.confirmed || status.block_height === undefined) return 'processing'

      const tip = await fetchLatestBlockHeight()
      const confirmations = tip - status.block_height + 1

      if (confirmations >= FINALIZED_THRESHOLD) return 'finalized'
      if (confirmations >= CONFIRMED_THRESHOLD) return 'confirmed'
      return 'processing'
    },
  })

  return data ?? null
}
