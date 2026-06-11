import { useEffect, useState } from 'react'

import { fetchLatestBlockHeight, fetchTxStatus } from '@/api/esplora/methods'

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
  const [confirmedTx, setConfirmedTx] = useState<ConfirmedTx | null>(null)

  useEffect(() => {
    if (!txid) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const status = await fetchTxStatus(txid)
        if (cancelled) return

        if (!status.confirmed) {
          setConfirmedTx(prev =>
            prev?.phase === 'processing' ? prev : { txid, phase: 'processing', confirmations: 0 },
          )
          return
        }

        const tip = await fetchLatestBlockHeight()
        if (cancelled) return

        const confirmations = status.block_height !== undefined ? tip - status.block_height + 1 : 1
        setConfirmedTx({ txid, phase: 'confirmed', confirmations })
        if (intervalId) clearInterval(intervalId)
      } catch {
        // tx not yet broadcast or network error — keep polling
      }
    }

    void poll()
    intervalId = setInterval(() => void poll(), pollIntervalMs)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [txid, pollIntervalMs])

  return confirmedTx?.txid === txid ? confirmedTx : null
}
