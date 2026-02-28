/**
 * Post-broadcast UI: wait for tx in mempool (poll esplora.getTx), then show success with txid (copy + explorer link).
 * BroadcastStatusContent can be used inside an existing Modal; PostBroadcastModal is a standalone modal wrapper.
 */

import { useState, useEffect } from 'react'
import type { EsploraClient } from '../api/esplora'
import { CopyIcon } from './CopyIcon'
import { Modal } from './Modal'

const POLL_INTERVAL_MS = 2000
const WAIT_FOR_TX_TIMEOUT_MS = 60_000

export interface BroadcastStatusContentProps {
  txid: string
  successMessage: string
  esplora: EsploraClient
  onClose: () => void
}

export function BroadcastStatusContent({
  txid,
  successMessage,
  esplora,
  onClose,
}: BroadcastStatusContentProps) {
  const [phase, setPhase] = useState<'waiting' | 'success'>(() => 'waiting')

  useEffect(() => {
    if (!txid?.trim() || !esplora) return

    let cancelled = false
    const startedAt = Date.now()

    const poll = () => {
      if (cancelled) return
      if (Date.now() - startedAt > WAIT_FOR_TX_TIMEOUT_MS) {
        setPhase('success')
        return
      }
      esplora
        .getTx(txid)
        .then(() => {
          if (!cancelled) setPhase('success')
        })
        .catch(() => {
          /* ignore; will retry on next interval */
        })
    }

    poll()
    const intervalId = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [txid, esplora])

  if (phase === 'waiting') {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 rounded-xl border border-gray-200 bg-gray-50/80 py-12 px-6"
        role="status"
        aria-live="polite"
      >
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"
          aria-hidden
        />
        <p className="text-center text-sm font-medium text-gray-700">
          Transaction broadcast. Waiting for it to appear in the network…
        </p>
        <p className="font-mono text-xs text-gray-500">{txid.slice(0, 8)}…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="font-medium text-gray-900">{successMessage}</p>
      <div className="flex items-center gap-2 min-w-0">
        <a
          href={esplora.getTxExplorerUrl(txid)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs break-all text-indigo-600 hover:underline"
        >
          {txid}
        </a>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(txid)}
          title="Copy txid"
          aria-label="Copy txid"
          className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          <CopyIcon className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Close
      </button>
    </div>
  )
}

export interface PostBroadcastModalProps {
  open: boolean
  onClose: () => void
  txid: string | null
  successMessage: string
  esplora: EsploraClient
}

export function PostBroadcastModal({
  open,
  onClose,
  txid,
  successMessage,
  esplora,
}: PostBroadcastModalProps) {
  if (!open || !txid?.trim()) return null

  return (
    <Modal open={open} onClose={onClose} title="Transaction sent" contentClassName="max-w-xl">
      <BroadcastStatusContent
        txid={txid}
        successMessage={successMessage}
        esplora={esplora}
        onClose={onClose}
      />
    </Modal>
  )
}
