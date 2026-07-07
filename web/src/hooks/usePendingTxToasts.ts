import { useEffect, useRef } from 'react'

import { pendingTxToastQueue } from '@/providers/pendingTransactions/pendingTxToastQueue'
import type { PendingTxKind, PendingTxRecord } from '@/providers/pendingTransactions/types'
import { PENDING_TX_KIND_LABEL } from '@/utils/pendingTransactions'

interface TrackedEntry {
  toastKey: string | null
  label: string
  kind: PendingTxKind
}

/**
 * One toast per tx, two states (bottom-center, plain language):
 * "Waiting for transaction..." (persistent, from the moment it's surfaced) -> "Transaction
 * confirmed" (once the indexer actually catches up and the record is cleaned up) or a failure
 * message if it times out. Only for txids the user explicitly "surfaced" by closing that tx's
 * modal early while it was still pending; tx tracking itself never depends on this.
 */
export function usePendingTxToasts(pendingTxs: PendingTxRecord[], surfacedTxids: Set<string>) {
  const trackedRef = useRef<Map<string, TrackedEntry>>(new Map())

  useEffect(() => {
    const currentTxids = new Set(pendingTxs.map(record => record.txid))

    for (const record of pendingTxs) {
      if (!surfacedTxids.has(record.txid)) continue

      const existing = trackedRef.current.get(record.txid)
      const label = existing?.label ?? PENDING_TX_KIND_LABEL[record.kind]

      if (record.confirmationStatus === 'failed') {
        if (existing && existing.toastKey === null) continue // already showing the failure toast
        if (existing?.toastKey) pendingTxToastQueue.close(existing.toastKey)
        pendingTxToastQueue.add(
          { title: label, description: "Couldn't confirm - check your wallet", variant: 'danger' },
          { timeout: 0 },
        )
        trackedRef.current.set(record.txid, { toastKey: null, label, kind: record.kind })
        continue
      }

      if (existing) continue // already showing "Waiting for transaction..."

      const toastKey = pendingTxToastQueue.add(
        { title: label, description: 'Waiting for transaction...', isLoading: true },
        { timeout: 0 },
      )
      trackedRef.current.set(record.txid, { toastKey, label, kind: record.kind })
    }

    for (const [txid, entry] of trackedRef.current) {
      if (currentTxids.has(txid)) continue

      if (entry.toastKey) {
        pendingTxToastQueue.close(entry.toastKey)
        const isCreatedOffer = entry.kind === 'create_offer'
        pendingTxToastQueue.add(
          {
            title: isCreatedOffer ? 'Offer created' : entry.label,
            description: isCreatedOffer
              ? 'Your offer is now visible in the table.'
              : 'Transaction confirmed',
            variant: 'success',
          },
          { timeout: 6_000 },
        )
      }
      trackedRef.current.delete(txid)
    }
  }, [pendingTxs, surfacedTxids])
}
