import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { fetchBorrowerOffers, fetchFactoriesByScript, fetchOffer } from '@/api/indexer/methods'
import { borrowerQueryKeys, factoryQueryKeys, offersQueryKeys } from '@/api/indexer/queryKeys'
import { PendingTxToasts } from '@/hooks/usePendingTxToasts'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/wallet/useWallet'

import { PendingTransactionsContext } from './PendingTransactionsContext'
import { deletePendingTx, loadPendingTxsForWallet, putPendingTx } from './storage'
import type { AddPendingTxInput, PendingTxRecord } from './types'

const CONFIRMATION_POLL_MS = 15_000
const INDEXER_POLL_MS = 10_000
const STUCK_AFTER_FINALIZED_MS = 2 * 60 * 1000
/** Defensive cap on how long a pending record can sit untracked before we give up on it. */
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 15_000

function PendingTxConfirmationTracker({
  record,
  onUpdate,
}: {
  record: PendingTxRecord
  onUpdate: (txid: string, patch: Partial<PendingTxRecord>) => void
}) {
  const { status, confirmations } = useTxStatus(record.txid, CONFIRMATION_POLL_MS)

  useEffect(() => {
    if (status === null) return
    // `TxStatus` ('processing' | 'confirmed' | 'finalized') is a subset of
    // `PendingTxConfirmationStatus`, so it can be stored directly with no mapping.
    if (status === record.confirmationStatus && confirmations === record.confirmations) return
    const patch: Partial<PendingTxRecord> = { confirmationStatus: status, confirmations }
    if (status === 'finalized' && !record.finalizedAt) {
      patch.finalizedAt = Date.now()
    }
    onUpdate(record.txid, patch)
    // `record`/`onUpdate` are deliberately omitted: they get a new identity on every parent
    // render, and re-running this on every such render (instead of only on real Esplora-poll
    // changes) would make it fire constantly instead of just on status/confirmation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, confirmations])

  return null
}

function OfferCleanupWatcher({
  offerId,
  records,
  onRemove,
  onChecked,
}: {
  offerId: string
  records: PendingTxRecord[]
  onRemove: (txid: string) => void
  onChecked: (txid: string) => void
}) {
  const { data: offer, isSuccess } = useQuery({
    queryKey: offersQueryKeys.detail(offerId),
    queryFn: ({ signal }) => fetchOffer(offerId, { signal }),
    refetchInterval: INDEXER_POLL_MS,
  })

  useEffect(() => {
    if (!isSuccess || !offer) return
    for (const record of records) {
      const isCleaned =
        record.kind === 'claim_principal'
          ? !offer.borrower_principal_utxo
          : record.expectedOfferStatus !== undefined && offer.status === record.expectedOfferStatus

      if (isCleaned) {
        onRemove(record.txid)
      } else {
        onChecked(record.txid)
      }
    }
    // `records`/`onRemove`/`onChecked` are deliberately omitted: they get a new identity on every
    // parent render, and listing them would re-run this on every such render instead of only when
    // the polled offer data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, offer])

  return null
}

function CreateOfferCleanupWatcher({
  scriptPubkey,
  records,
  onRemove,
  onChecked,
}: {
  scriptPubkey: string
  records: PendingTxRecord[]
  onRemove: (txid: string) => void
  onChecked: (txid: string) => void
}) {
  const { data, isSuccess } = useQuery({
    queryKey: borrowerQueryKeys.offers(scriptPubkey, {}),
    queryFn: ({ signal }) => fetchBorrowerOffers(scriptPubkey, {}, { signal }),
    refetchInterval: INDEXER_POLL_MS,
  })

  useEffect(() => {
    if (!isSuccess || !data) return
    for (const record of records) {
      const matched = data.items.find(offer => offer.created_at_txid === record.txid)
      if (matched) {
        onRemove(record.txid)
      } else {
        onChecked(record.txid)
      }
    }
    // `records`/`onRemove`/`onChecked` are deliberately omitted: they get a new identity on every
    // parent render, and listing them would re-run this on every such render instead of only when
    // the polled offers list actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data])

  return null
}

function CreateBorrowerAccountCleanupWatcher({
  scriptPubkey,
  records,
  onRemove,
  onChecked,
}: {
  scriptPubkey: string
  records: PendingTxRecord[]
  onRemove: (txid: string) => void
  onChecked: (txid: string) => void
}) {
  const { data, isSuccess } = useQuery({
    queryKey: factoryQueryKeys.byScript(scriptPubkey),
    queryFn: ({ signal }) => fetchFactoriesByScript(scriptPubkey, { signal }),
    refetchInterval: INDEXER_POLL_MS,
  })

  useEffect(() => {
    if (!isSuccess || !data) return
    for (const record of records) {
      const matched = data.find(factory => factory.created_at_txid === record.txid)
      if (matched) {
        onRemove(record.txid)
      } else {
        onChecked(record.txid)
      }
    }
    // `records`/`onRemove`/`onChecked` are deliberately omitted: they get a new identity on every
    // parent render, and listing them would re-run this on every such render instead of only when
    // the polled factories list actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, data])

  return null
}

/**
 * Owns pending-tx state for one wallet. Remounted (via `key`) whenever the connected wallet
 * changes, so state resets to a clean slate without ever calling setState synchronously from
 * within an effect just to clear stale data for the previous wallet.
 */
function PendingTransactionsStore({
  scriptPubkey,
  children,
}: {
  scriptPubkey: string | null
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const [pendingTxs, setPendingTxs] = useState<PendingTxRecord[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(scriptPubkey))
  const [surfacedTxids, setSurfacedTxids] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!scriptPubkey) return
    let cancelled = false
    loadPendingTxsForWallet(scriptPubkey).then(records => {
      if (!cancelled) {
        setPendingTxs(records)
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [scriptPubkey])

  const invalidateIndexerQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['offers'] })
    queryClient.invalidateQueries({ queryKey: ['borrower'] })
    queryClient.invalidateQueries({ queryKey: ['lender'] })
    queryClient.invalidateQueries({ queryKey: ['factories'] })
  }, [queryClient])

  const addPendingTx = useCallback(
    async (input: AddPendingTxInput) => {
      const now = Date.now()
      const record: PendingTxRecord = {
        ...input,
        confirmationStatus: 'processing',
        confirmations: null,
        createdAt: now,
        updatedAt: now,
      }
      await putPendingTx(record)
      setPendingTxs(prev => [...prev, record])
      invalidateIndexerQueries()
    },
    [invalidateIndexerQueries],
  )

  const updatePendingTx = useCallback(async (txid: string, patch: Partial<PendingTxRecord>) => {
    setPendingTxs(prev => {
      const next = prev.map(record =>
        record.txid === txid ? { ...record, ...patch, updatedAt: Date.now() } : record,
      )
      const updated = next.find(record => record.txid === txid)
      if (updated) void putPendingTx(updated)
      return next
    })
  }, [])

  const removePendingTx = useCallback(
    async (txid: string) => {
      await deletePendingTx(txid)
      setPendingTxs(prev => prev.filter(record => record.txid !== txid))
      // The record is only removed once a cleanup watcher confirms the indexer caught up — that's
      // exactly when other pages' stale list/detail caches need to be told to refetch too.
      invalidateIndexerQueries()
    },
    [invalidateIndexerQueries],
  )

  const markChecked = useCallback(
    (txid: string) => {
      void updatePendingTx(txid, { lastIndexerCheckAt: Date.now() })
    },
    [updatePendingTx],
  )

  const removeByTxid = useCallback(
    (txid: string) => {
      void removePendingTx(txid)
    },
    [removePendingTx],
  )

  const addSurfaceToast = useCallback((txid: string) => {
    setSurfacedTxids(prev => (prev.has(txid) ? prev : new Set(prev).add(txid)))
  }, [])

  // 2-minute stuck-after-finalized sweep + 24h defensive max-age cap.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      for (const record of pendingTxs) {
        if (record.confirmationStatus === 'failed') continue
        if (
          record.confirmationStatus === 'finalized' &&
          record.finalizedAt &&
          now - record.finalizedAt > STUCK_AFTER_FINALIZED_MS
        ) {
          void updatePendingTx(record.txid, {
            confirmationStatus: 'failed',
            errorMessage: 'Indexer did not confirm in time.',
          })
          continue
        }
        if (now - record.createdAt > MAX_PENDING_AGE_MS) {
          void updatePendingTx(record.txid, {
            confirmationStatus: 'failed',
            errorMessage: 'Transaction tracking timed out.',
          })
        }
      }
    }, SWEEP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [pendingTxs, updatePendingTx])

  const activeRecords = useMemo(
    () => pendingTxs.filter(record => record.confirmationStatus !== 'failed'),
    [pendingTxs],
  )

  const offerIdGroups = useMemo(() => {
    const groups = new Map<string, PendingTxRecord[]>()
    for (const record of activeRecords) {
      if (!record.offerId) continue
      const group = groups.get(record.offerId) ?? []
      group.push(record)
      groups.set(record.offerId, group)
    }
    return groups
  }, [activeRecords])

  const createOfferRecords = useMemo(
    () => activeRecords.filter(record => record.kind === 'create_offer'),
    [activeRecords],
  )
  const createBorrowerAccountRecords = useMemo(
    () => activeRecords.filter(record => record.kind === 'create_borrower_account'),
    [activeRecords],
  )

  const contextValue = useMemo(
    () => ({
      pendingTxs,
      isLoading,
      addPendingTx,
      updatePendingTx,
      removePendingTx,
      addSurfaceToast,
    }),
    [pendingTxs, isLoading, addPendingTx, updatePendingTx, removePendingTx, addSurfaceToast],
  )

  return (
    <PendingTransactionsContext.Provider value={contextValue}>
      {children}
      {activeRecords.map(record => (
        <PendingTxConfirmationTracker
          key={record.txid}
          record={record}
          onUpdate={(txid, patch) => void updatePendingTx(txid, patch)}
        />
      ))}
      {[...offerIdGroups.entries()].map(([offerId, records]) => (
        <OfferCleanupWatcher
          key={offerId}
          offerId={offerId}
          records={records}
          onRemove={removeByTxid}
          onChecked={markChecked}
        />
      ))}
      {scriptPubkey && createOfferRecords.length > 0 && (
        <CreateOfferCleanupWatcher
          scriptPubkey={scriptPubkey}
          records={createOfferRecords}
          onRemove={removeByTxid}
          onChecked={markChecked}
        />
      )}
      {scriptPubkey && createBorrowerAccountRecords.length > 0 && (
        <CreateBorrowerAccountCleanupWatcher
          scriptPubkey={scriptPubkey}
          records={createBorrowerAccountRecords}
          onRemove={removeByTxid}
          onChecked={markChecked}
        />
      )}
      <PendingTxToasts pendingTxs={pendingTxs} surfacedTxids={surfacedTxids} />
    </PendingTransactionsContext.Provider>
  )
}

export function PendingTransactionsProvider({ children }: PropsWithChildren) {
  const { scriptPubkey } = useWallet()

  return (
    <PendingTransactionsStore key={scriptPubkey ?? 'disconnected'} scriptPubkey={scriptPubkey}>
      {children}
    </PendingTransactionsStore>
  )
}
