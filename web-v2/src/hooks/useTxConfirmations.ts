import { useQuery } from '@tanstack/react-query'

import { fetchLatestBlockHeight, fetchTxStatus } from '@/api/esplora/methods'

const REQUIRED_CONFIRMATIONS = 2

export interface ConfirmedTx {
  txid: string
  phase: 'processing' | 'confirmed'
  confirmations: number
}

export function useTxConfirmations({
  txid,
  pollIntervalMs = 15_000,
}: {
  txid?: string | null
  pollIntervalMs?: number
}): ConfirmedTx | null {
  const { data } = useQuery({
    queryKey: ['tx-confirmations', txid],
    enabled: Boolean(txid),
    refetchInterval: query => (query.state.data?.phase === 'confirmed' ? false : pollIntervalMs),
    queryFn: async (): Promise<ConfirmedTx> => {
      const status = await fetchTxStatus(txid as string)

      if (!status.confirmed || status.block_height === undefined) {
        return { txid: txid as string, phase: 'processing', confirmations: 0 }
      }

      const tip = await fetchLatestBlockHeight()
      const confirmations = tip - status.block_height + 1

      return {
        txid: txid as string,
        phase: confirmations >= REQUIRED_CONFIRMATIONS ? 'confirmed' : 'processing',
        confirmations,
      }
    },
  })

  return data?.txid === txid ? (data ?? null) : null
}
