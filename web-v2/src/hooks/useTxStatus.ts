import { useQuery } from '@tanstack/react-query'

import { fetchLatestBlockHeight, fetchTxStatus } from '@/api/esplora/methods'

const CONFIRMED_THRESHOLD = 1
const FINALIZED_THRESHOLD = 2

export type TxStatus = 'processing' | 'confirmed' | 'finalized'

export function useTxStatus(
  txid?: string | null,
  pollIntervalMs = 15_000,
): { status: TxStatus | null; confirmations: number | null; isComplete: boolean } {
  const { data } = useQuery({
    queryKey: ['tx-status', txid],
    enabled: Boolean(txid),
    refetchInterval: query => (query.state.data?.status === 'finalized' ? false : pollIntervalMs),
    queryFn: async () => {
      const txStatus = await fetchTxStatus(txid as string)

      if (!txStatus.confirmed || txStatus.block_height === undefined) {
        return { status: 'processing' as TxStatus, confirmations: null }
      }

      const tip = await fetchLatestBlockHeight()
      const confirmations = tip - txStatus.block_height + 1
      const status: TxStatus =
        confirmations >= FINALIZED_THRESHOLD
          ? 'finalized'
          : confirmations >= CONFIRMED_THRESHOLD
            ? 'confirmed'
            : 'processing'

      return { status, confirmations }
    },
  })

  const { status, confirmations } = data ?? { status: null, confirmations: null }
  const isComplete = status === 'confirmed' || status === 'finalized'
  return { status, confirmations, isComplete }
}
