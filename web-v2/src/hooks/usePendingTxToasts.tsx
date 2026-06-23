import { useEffect, useRef } from 'react'

import { pendingTxToastQueue } from '@/providers/pendingTransactions/pendingTxToastQueue'
import type {
  PendingTxConfirmationStatus,
  PendingTxRecord,
} from '@/providers/pendingTransactions/types'
import { PENDING_TX_KIND_LABEL } from '@/utils/pendingTransactions'

const MILESTONE_ORDER: PendingTxConfirmationStatus[] = [
  'broadcasted',
  'confirmed',
  'finalized',
  'failed',
]

function milestoneRank(status: PendingTxConfirmationStatus): number {
  return MILESTONE_ORDER.indexOf(status)
}

interface ProgressEntry {
  rank: number
  toastKey: string | null
}

/**
 * Two independent toast behaviors (bottom-center, friendly plain-language text):
 * - Progress toasts (Submitting…/Confirming…/Confirmed) only for txids the user explicitly
 *   "surfaced" by closing that tx's modal early while it was still pending.
 * - A "Done" toast fires unconditionally for every tx that completes (gets cleaned up by the
 *   indexer), regardless of whether it was ever surfaced — so completion is always acknowledged
 *   even if the user never opened/closed a modal for it while it was in flight.
 * Tx tracking itself (confirmations, cleanup) never depends on any of this.
 */
export function PendingTxToasts({
  pendingTxs,
  surfacedTxids,
}: {
  pendingTxs: PendingTxRecord[]
  surfacedTxids: Set<string>
}) {
  const progressRef = useRef<Map<string, ProgressEntry>>(new Map())
  const seenLabelsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const currentTxids = new Set(pendingTxs.map(record => record.txid))

    for (const record of pendingTxs) {
      seenLabelsRef.current.set(record.txid, PENDING_TX_KIND_LABEL[record.kind])

      if (!surfacedTxids.has(record.txid)) continue

      const rank = milestoneRank(record.confirmationStatus)
      const previous = progressRef.current.get(record.txid)
      if (previous && previous.rank >= rank) continue

      if (previous?.toastKey) pendingTxToastQueue.close(previous.toastKey)

      const label = PENDING_TX_KIND_LABEL[record.kind]
      let toastKey: string | null = null
      switch (record.confirmationStatus) {
        case 'broadcasted':
          toastKey = pendingTxToastQueue.add(
            { title: label, description: 'Submitting…', isLoading: true },
            { timeout: 0 },
          )
          break
        case 'confirmed':
          toastKey = pendingTxToastQueue.add(
            { title: label, description: 'Confirming…', isLoading: true },
            { timeout: 0 },
          )
          break
        case 'finalized':
          toastKey = pendingTxToastQueue.add(
            { title: label, description: 'Confirmed', variant: 'success' },
            { timeout: 0 },
          )
          break
        case 'failed':
          toastKey = pendingTxToastQueue.add(
            {
              title: label,
              description: "Couldn't confirm — check your wallet",
              variant: 'danger',
            },
            { timeout: 0 },
          )
          break
      }

      progressRef.current.set(record.txid, { rank, toastKey })
    }

    for (const [txid, label] of seenLabelsRef.current) {
      if (currentTxids.has(txid)) continue

      const progress = progressRef.current.get(txid)
      if (progress?.toastKey) pendingTxToastQueue.close(progress.toastKey)
      pendingTxToastQueue.add(
        { title: label, description: 'Done', variant: 'success' },
        { timeout: 6_000 },
      )

      progressRef.current.delete(txid)
      seenLabelsRef.current.delete(txid)
    }
  }, [pendingTxs, surfacedTxids])

  return null
}
