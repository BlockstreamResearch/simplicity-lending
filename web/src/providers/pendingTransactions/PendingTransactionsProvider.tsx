import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { fetchTxConfirmations } from '@/api/esplora/methods'
import { fetchBorrowerOffers, fetchFactoriesByScript, fetchOffer } from '@/api/indexer/methods'
import {
  borrowerQueryKeys,
  factoryQueryKeys,
  lenderQueryKeys,
  offersQueryKeys,
} from '@/api/indexer/queryKeys'
import { useLatestRef } from '@/hooks/useLatestRef'
import { usePendingTxToasts } from '@/hooks/usePendingTxToasts'
import { useWallet } from '@/providers/wallet/useWallet'

import { PendingTransactionsContext } from './PendingTransactionsContext'
import { deletePendingTx, loadPendingTxsForWallet, putPendingTx } from './storage'
import type { AddPendingTxInput, PendingTxRecord } from './types'

const CONFIRMATION_POLL_MS = 15_000
const INDEXER_POLL_MS = 10_000
const CONFIRMED_THRESHOLD = 1
const FINALIZED_THRESHOLD = 2
/** Defensive cap on how long a pending record can sit untracked before we give up on it. */
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 15_000

type OfferRecordGroup = [offerId: string, records: PendingTxRecord[]]
type TrackedTxStatus = 'processing' | 'confirmed' | 'finalized'

interface TxStatusSnapshot {
  status: TrackedTxStatus
  confirmations: number | null
}

function usePendingTxConfirmationTracking(
  records: PendingTxRecord[],
  onUpdate: (txid: string, patch: Partial<PendingTxRecord>) => void,
) {
  const recordsRef = useLatestRef(records)
  const onUpdateRef = useLatestRef(onUpdate)
  const snapshots = useQueries({
    queries: records.map(record => ({
      queryKey: ['tx-status', record.txid],
      enabled: record.confirmationStatus !== 'finalized',
      refetchInterval: CONFIRMATION_POLL_MS,
      queryFn: async ({ signal }) => {
        const confirmations = await fetchTxConfirmations(record.txid, { signal })
        if (confirmations === null) {
          return { status: 'processing', confirmations } satisfies TxStatusSnapshot
        }

        const status: TrackedTxStatus =
          confirmations >= FINALIZED_THRESHOLD
            ? 'finalized'
            : confirmations >= CONFIRMED_THRESHOLD
              ? 'confirmed'
              : 'processing'

        return { status, confirmations } satisfies TxStatusSnapshot
      },
    })),
    combine: results => results.map(result => result.data ?? null),
  })

  useEffect(() => {
    snapshots.forEach((snapshot, index) => {
      const record = recordsRef.current[index]
      if (!record || !snapshot) return
      if (
        snapshot.status === record.confirmationStatus &&
        snapshot.confirmations === record.confirmations
      ) {
        return
      }

      // `TxStatus` ('processing' | 'confirmed' | 'finalized') is a subset of
      // `PendingTxConfirmationStatus`, so it can be stored directly with no mapping.
      const patch: Partial<PendingTxRecord> = {
        confirmationStatus: snapshot.status,
        confirmations: snapshot.confirmations,
      }
      if (snapshot.status === 'finalized' && !record.finalizedAt) {
        patch.finalizedAt = Date.now()
      }
      onUpdateRef.current(record.txid, patch)
    })
  }, [onUpdateRef, recordsRef, snapshots])
}

function useOfferCleanupPolling({
  offerGroups,
  onRemove,
  onChecked,
}: {
  offerGroups: OfferRecordGroup[]
  onRemove: (txid: string) => void
  onChecked: (txid: string) => void
}) {
  const offerGroupsRef = useLatestRef(offerGroups)
  const onRemoveRef = useLatestRef(onRemove)
  const onCheckedRef = useLatestRef(onChecked)
  const processedAtRef = useRef(new Map<string, number>())
  const results = useQueries({
    queries: offerGroups.map(([offerId]) => ({
      queryKey: offersQueryKeys.detail(offerId),
      queryFn: ({ signal }) => fetchOffer(offerId, { signal }),
      refetchInterval: INDEXER_POLL_MS,
    })),
    combine: queryResults =>
      queryResults.map(result => ({
        data: result.data,
        dataUpdatedAt: result.dataUpdatedAt,
        isSuccess: result.isSuccess,
      })),
  })

  useEffect(() => {
    results.forEach((result, index) => {
      const group = offerGroupsRef.current[index]
      if (!group || !result.isSuccess || !result.data) return

      const [offerId, records] = group
      if (processedAtRef.current.get(offerId) === result.dataUpdatedAt) return
      processedAtRef.current.set(offerId, result.dataUpdatedAt)

      for (const record of records) {
        const isCleaned =
          record.kind === 'claim_principal'
            ? !result.data.borrower_principal_utxo && record.confirmationStatus !== 'processing'
            : record.expectedOfferStatus !== undefined &&
              result.data.status === record.expectedOfferStatus

        if (isCleaned) {
          onRemoveRef.current(record.txid)
        } else {
          onCheckedRef.current(record.txid)
        }
      }
    })
  }, [offerGroupsRef, onCheckedRef, onRemoveRef, results])

  useEffect(() => {
    const offerIds = new Set(offerGroups.map(([offerId]) => offerId))
    for (const offerId of processedAtRef.current.keys()) {
      if (!offerIds.has(offerId)) processedAtRef.current.delete(offerId)
    }
  }, [offerGroups])
}

function useCreateOfferCleanupPolling({
  scriptPubkey,
  records,
  onRemove,
  onChecked,
}: {
  scriptPubkey: string | null
  records: PendingTxRecord[]
  onRemove: (txid: string) => void
  onChecked: (txid: string) => void
}) {
  const recordsRef = useLatestRef(records)
  const onRemoveRef = useLatestRef(onRemove)
  const onCheckedRef = useLatestRef(onChecked)
  const processedAtRef = useRef<number | null>(null)
  const { data, dataUpdatedAt, isSuccess } = useQuery({
    queryKey: borrowerQueryKeys.offers(scriptPubkey ?? '', {}),
    queryFn: ({ signal }) => fetchBorrowerOffers(scriptPubkey as string, {}, { signal }),
    enabled: Boolean(scriptPubkey && records.length > 0),
    refetchInterval: INDEXER_POLL_MS,
    select: response => response.items,
  })

  useEffect(() => {
    if (processedAtRef.current === dataUpdatedAt) return
    if (!isSuccess || !data) return
    processedAtRef.current = dataUpdatedAt

    for (const record of recordsRef.current) {
      const matched = data.find(offer => offer.created_at_txid === record.txid)
      if (matched) {
        onRemoveRef.current(record.txid)
      } else {
        onCheckedRef.current(record.txid)
      }
    }
  }, [data, dataUpdatedAt, isSuccess, onCheckedRef, onRemoveRef, recordsRef])
}

function useCreateBorrowerAccountCleanupPolling({
  scriptPubkey,
  records,
  onRemove,
  onChecked,
}: {
  scriptPubkey: string | null
  records: PendingTxRecord[]
  onRemove: (txid: string) => void
  onChecked: (txid: string) => void
}) {
  const recordsRef = useLatestRef(records)
  const onRemoveRef = useLatestRef(onRemove)
  const onCheckedRef = useLatestRef(onChecked)
  const processedAtRef = useRef<number | null>(null)
  const { data, dataUpdatedAt, isSuccess } = useQuery({
    queryKey: factoryQueryKeys.byScript(scriptPubkey ?? ''),
    queryFn: ({ signal }) => fetchFactoriesByScript(scriptPubkey as string, { signal }),
    enabled: Boolean(scriptPubkey && records.length > 0),
    refetchInterval: INDEXER_POLL_MS,
  })

  useEffect(() => {
    if (processedAtRef.current === dataUpdatedAt) return
    if (!isSuccess || !data) return
    processedAtRef.current = dataUpdatedAt

    for (const record of recordsRef.current) {
      const matched = data.find(factory => factory.created_at_txid === record.txid)
      if (matched) {
        onRemoveRef.current(record.txid)
      } else {
        onCheckedRef.current(record.txid)
      }
    }
  }, [data, dataUpdatedAt, isSuccess, onCheckedRef, onRemoveRef, recordsRef])
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
    loadPendingTxsForWallet(scriptPubkey)
      .catch(error => {
        console.warn('[PendingTransactions] Failed to load pending transactions', error)
        return []
      })
      .then(records => {
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
    queryClient.invalidateQueries({ queryKey: offersQueryKeys.all() })
    queryClient.invalidateQueries({ queryKey: borrowerQueryKeys.all() })
    queryClient.invalidateQueries({ queryKey: lenderQueryKeys.all() })
    queryClient.invalidateQueries({ queryKey: factoryQueryKeys.all() })
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
      setPendingTxs(prev => [...prev, record])
      invalidateIndexerQueries()
      try {
        await putPendingTx(record)
      } catch (error) {
        console.warn('[PendingTransactions] Failed to persist pending transaction', error)
      }
    },
    [invalidateIndexerQueries],
  )

  const updatePendingTx = useCallback(async (txid: string, patch: Partial<PendingTxRecord>) => {
    setPendingTxs(prev => {
      const next = prev.map(record =>
        record.txid === txid ? { ...record, ...patch, updatedAt: Date.now() } : record,
      )
      const updated = next.find(record => record.txid === txid)
      if (updated) {
        void putPendingTx(updated).catch(error => {
          console.warn('[PendingTransactions] Failed to persist pending transaction', error)
        })
      }
      return next
    })
  }, [])

  const removePendingTx = useCallback(
    async (txid: string) => {
      setPendingTxs(prev => prev.filter(record => record.txid !== txid))
      // The record is only removed once a cleanup watcher confirms the indexer caught up — that's
      // exactly when other pages' stale list/detail caches need to be told to refetch too.
      invalidateIndexerQueries()
      try {
        await deletePendingTx(txid)
      } catch (error) {
        console.warn('[PendingTransactions] Failed to delete pending transaction', error)
      }
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

  // Finalized txs stay active until the indexer reflects the expected state and cleanup removes
  // them. That keeps duplicate actions disabled during indexer lag.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      for (const record of pendingTxs) {
        if (record.confirmationStatus === 'failed') continue
        if (
          record.confirmationStatus !== 'finalized' &&
          now - record.createdAt > MAX_PENDING_AGE_MS
        ) {
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
  const offerRecordGroups = useMemo<OfferRecordGroup[]>(
    () => [...offerIdGroups.entries()],
    [offerIdGroups],
  )

  usePendingTxConfirmationTracking(activeRecords, updatePendingTx)

  useOfferCleanupPolling({
    offerGroups: offerRecordGroups,
    onRemove: removeByTxid,
    onChecked: markChecked,
  })
  useCreateOfferCleanupPolling({
    scriptPubkey,
    records: createOfferRecords,
    onRemove: removeByTxid,
    onChecked: markChecked,
  })
  useCreateBorrowerAccountCleanupPolling({
    scriptPubkey,
    records: createBorrowerAccountRecords,
    onRemove: removeByTxid,
    onChecked: markChecked,
  })
  usePendingTxToasts(pendingTxs, surfacedTxids)

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
