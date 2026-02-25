/**
 * Borrower page: dashboard and Create Borrow Offer wizard in a popup.
 * Uses useAccountAddress for UTXOs and refresh after broadcast.
 * Offers are loaded from Indexer API (by-script + batch).
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import type { Tab } from '../../App'
import { useSeedHex } from '../../SeedContext'
import { useAccountAddress } from '../../hooks/useAccountAddress'
import {
  fetchOfferIdsByScript,
  fetchOfferDetailsBatchWithParticipants,
  filterOffersByParticipantRole,
} from '../../api/client'
import { EsploraClient, EsploraApiError } from '../../api/esplora'
import { getScriptPubkeyHexFromAddress } from '../../utility/addressP2pk'
import { CreateOfferWizard } from './CreateOfferWizard'
import { PrepareStep } from './PrepareStep'
import { Modal } from '../../components/Modal'
import { Input } from '../../components/Input'
import { formClassNames } from '../../components/formClassNames'
import { OfferTable } from '../../components/OfferTable'
import {
  getStoredPrepareTxid,
  savePrepareTxid,
  clearStoredPrepareTxid,
  getStoredAuxiliaryAssetId,
  saveStoredAuxiliaryAssetId,
  clearStoredAuxiliaryAssetId,
  getStoredPrepareFirstVout,
  saveStoredPrepareFirstVout,
  clearStoredPrepareFirstVout,
} from './borrowerStorage'
import type { OfferShort } from '../../types/offers'

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

type PrepareTab = 'create' | 'import'

function PrepareModalContent({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  onSuccess,
  onClose,
}: {
  accountIndex: number
  accountAddress: string | null
  utxos: import('../../api/esplora').ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  onSuccess: (txid: string, auxiliaryAssetId: string | undefined, firstVout: number) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<PrepareTab>('create')
  const [importTxid, setImportTxid] = useState('')
  const [importFirstVout, setImportFirstVout] = useState('0')
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const handleImport = useCallback(async () => {
    const txid = importTxid.trim()
    const firstVout = parseInt(importFirstVout, 10)
    if (!txid || Number.isNaN(firstVout) || firstVout < 0) {
      setImportError('Enter a valid txid and first vout (≥ 0).')
      return
    }
    setImportError(null)
    setImporting(true)
    try {
      const [tx, outspends] = await Promise.all([esplora.getTx(txid), esplora.getTxOutspends(txid)])
      const vouts = tx.vout ?? []
      for (let i = 0; i < 4; i++) {
        const idx = firstVout + i
        if (idx >= vouts.length) {
          setImportError(`Output at index ${idx} does not exist (tx has ${vouts.length} outputs).`)
          return
        }
      }
      const v0 = vouts[firstVout]
      const assetId = (v0?.asset ?? '').trim().toLowerCase()
      if (!assetId) {
        setImportError('First output has no asset.')
        return
      }
      for (let i = 1; i < 4; i++) {
        const v = vouts[firstVout + i]
        const a = (v?.asset ?? '').trim().toLowerCase()
        if (a !== assetId) {
          setImportError(`Output at index ${firstVout + i} has different asset.`)
          return
        }
      }
      for (let i = 0; i < 4; i++) {
        const o = outspends[firstVout + i]
        if (o?.spent) {
          setImportError(`Output at index ${firstVout + i} is already spent.`)
          return
        }
      }
      onSuccess(txid, assetId, firstVout)
    } catch (e) {
      setImportError(
        e instanceof EsploraApiError ? e.message : e instanceof Error ? e.message : String(e)
      )
    } finally {
      setImporting(false)
    }
  }, [importTxid, importFirstVout, esplora, onSuccess])

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">
        Create 4 UTXOs of a single auxiliary asset for Utility NFTs, or import an existing prepare
        by transaction ID and first output index.
      </p>
      <div
        className="inline-flex rounded-xl bg-gray-100 p-1 gap-0.5"
        role="tablist"
        aria-label="Prepare mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'create'}
          onClick={() => setTab('create')}
          className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
            tab === 'create'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Create new
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'import'}
          onClick={() => setTab('import')}
          className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
            tab === 'import'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Import
        </button>
      </div>
      {tab === 'create' ? (
        <PrepareStep
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          onSuccess={(txid, auxiliaryAssetId) => {
            onSuccess(txid, auxiliaryAssetId, 0)
          }}
        />
      ) : (
        <div className="space-y-3">
          <div>
            <label className={formClassNames.label}>Transaction ID</label>
            <Input
              type="text"
              value={importTxid}
              onChange={(e) => setImportTxid(e.target.value)}
              placeholder="txid hex"
              className="w-full font-mono"
            />
          </div>
          <div>
            <label className={formClassNames.label}>First vout (0-based index)</label>
            <Input
              type="number"
              min={0}
              value={importFirstVout}
              onChange={(e) => setImportFirstVout(e.target.value)}
              className="w-full"
            />
          </div>
          {importError && (
            <p className="text-red-600 text-xs" role="alert">
              {importError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="rounded-lg bg-[#5F3DC4] px-4 py-2 text-sm font-medium text-white hover:bg-[#4f36a8] disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function CreateOfferPage({
  accountIndex,
  onTab,
}: {
  accountIndex: number
  onTab: (t: Tab) => void
}) {
  const seedHex = useSeedHex()
  const esplora = useMemo(() => new EsploraClient(), [])
  const {
    address: accountAddress,
    utxos,
    loading,
    error,
    refresh,
  } = useAccountAddress({
    seedHex,
    accountIndex,
    esplora,
  })

  const [showCreateWizard, setShowCreateWizard] = useState(false)
  const [showPrepareModal, setShowPrepareModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [savedPreparedTxid, setSavedPreparedTxid] = useState<string | null>(() =>
    getStoredPrepareTxid(accountIndex)
  )
  const [savedAuxiliaryAssetId, setSavedAuxiliaryAssetId] = useState<string | null>(() =>
    getStoredAuxiliaryAssetId(accountIndex)
  )
  const [savedPrepareFirstVout, setSavedPrepareFirstVout] = useState<number>(() =>
    getStoredPrepareFirstVout(accountIndex)
  )
  const [prepareUtxosSpent, setPrepareUtxosSpent] = useState<boolean | null>(null)
  const [borrowOffers, setBorrowOffers] = useState<OfferShort[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)

  const loadBorrowOffers = useCallback(async () => {
    if (!accountAddress) {
      setBorrowOffers([])
      setOffersLoading(false)
      return
    }
    setOffersLoading(true)
    setOffersError(null)
    try {
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(accountAddress)
      const ids = await fetchOfferIdsByScript(scriptPubkeyHex)
      const [withParticipants, height] = await Promise.all([
        ids.length === 0 ? Promise.resolve([]) : fetchOfferDetailsBatchWithParticipants(ids),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      const list = filterOffersByParticipantRole(withParticipants, scriptPubkeyHex, 'borrower')
      setBorrowOffers(list)
      setCurrentBlockHeight(height)
    } catch (e) {
      setOffersError(e instanceof Error ? e.message : String(e))
      setBorrowOffers([])
    } finally {
      setOffersLoading(false)
    }
  }, [accountAddress, esplora])

  useEffect(() => {
    setSavedPreparedTxid(getStoredPrepareTxid(accountIndex))
    setSavedAuxiliaryAssetId(getStoredAuxiliaryAssetId(accountIndex))
    setSavedPrepareFirstVout(getStoredPrepareFirstVout(accountIndex))
  }, [accountIndex])

  useEffect(() => {
    if (!savedPreparedTxid?.trim()) {
      setPrepareUtxosSpent(null)
      return
    }
    const first = savedPrepareFirstVout
    let cancelled = false
    esplora
      .getTxOutspends(savedPreparedTxid)
      .then((outspends) => {
        if (cancelled) return
        const indices = [first, first + 1, first + 2, first + 3]
        const anySpent = indices.some((i) => outspends[i]?.spent === true)
        setPrepareUtxosSpent(anySpent)
      })
      .catch(() => {
        if (!cancelled) setPrepareUtxosSpent(null)
      })
    return () => {
      cancelled = true
    }
  }, [esplora, savedPreparedTxid, savedPrepareFirstVout])

  useEffect(() => {
    loadBorrowOffers()
  }, [loadBorrowOffers])

  const hasPrepared = Boolean(savedPreparedTxid?.trim()) && Boolean(savedAuxiliaryAssetId?.trim())

  const handleClearPrepare = useCallback(() => {
    clearStoredPrepareTxid(accountIndex)
    clearStoredAuxiliaryAssetId(accountIndex)
    clearStoredPrepareFirstVout(accountIndex)
    setSavedPreparedTxid(null)
    setSavedAuxiliaryAssetId(null)
    setSavedPrepareFirstVout(0)
    setShowSettingsModal(false)
  }, [accountIndex])

  const handlePrepareAgain = useCallback(() => {
    handleClearPrepare()
    setShowPrepareModal(true)
  }, [handleClearPrepare])

  if (!seedHex) {
    return <p className="text-gray-600">Connect seed to create an offer.</p>
  }

  if (loading) {
    return <p className="text-gray-600">Loading…</p>
  }

  if (error) {
    return <p className="text-red-700 bg-red-50 p-4 rounded-lg">{error}</p>
  }

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={() => onTab('dashboard')}
        className="flex items-center gap-1 text-gray-700 hover:text-gray-900 focus:outline-none focus:ring-0"
      >
        <span aria-hidden>&lt;</span>
        <span>Back to Dashboard</span>
      </button>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700">
              L
            </span>
            <h2 className="text-base font-semibold text-gray-900">LBTC</h2>
          </div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-gray-500">COMPLETE BALANCE LBTC</span>
            <span className="text-sm font-medium text-green-600">24H +2.3%</span>
          </div>
          <p className="mb-1 text-2xl font-bold text-gray-900">7.00976</p>
          <p className="mb-4 text-sm text-gray-500">$792,852.21 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">LBTC LOCKED:</span>{' '}
            <span className="text-gray-600">3 LBTC</span>
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-100 text-xs font-medium text-pink-700">
              U
            </span>
            <h2 className="text-base font-semibold text-gray-900">USDT</h2>
          </div>
          <div className="mb-2 text-sm text-gray-500">COMPLETE BALANCE USDT</div>
          <p className="mb-1 text-2xl font-bold text-gray-900">50,000.00</p>
          <p className="mb-4 text-sm text-gray-500">$49,929.07 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">BORROWED:</span>{' '}
            <span className="text-gray-600">50,000 USDT</span>
          </p>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <WalletIcon className="text-gray-500 shrink-0" />
            <h3 className="text-base font-semibold text-gray-900">YOUR BORROWS</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Borrower settings"
            title="Borrower settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </div>
        <OfferTable
          offers={borrowOffers}
          loading={offersLoading}
          error={offersError}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadBorrowOffers}
          emptyMessage="No borrows yet"
        />
      </section>

      {hasPrepared && prepareUtxosSpent === true ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="mb-2">
            One or more prepare UTXOs have already been spent. Please prepare again.
          </p>
          <button
            type="button"
            onClick={handlePrepareAgain}
            className="rounded-lg bg-[#5F3DC4] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4f36a8]"
          >
            Prepare again
          </button>
        </div>
      ) : hasPrepared ? (
        <button
          type="button"
          onClick={() => setShowCreateWizard(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#5F3DC4] px-4 py-2 text-sm font-medium text-white hover:bg-[#4f36a8]"
        >
          <span>+</span>
          Create Borrow Offer
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowPrepareModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#5F3DC4] px-4 py-2 text-sm font-medium text-white hover:bg-[#4f36a8]"
        >
          Prepare to be a borrower
        </button>
      )}

      <Modal
        open={showPrepareModal}
        onClose={() => setShowPrepareModal(false)}
        title="Prepare to be a borrower"
      >
        <PrepareModalContent
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          onSuccess={(txid, auxiliaryAssetId, firstVout) => {
            savePrepareTxid(accountIndex, txid)
            saveStoredAuxiliaryAssetId(accountIndex, auxiliaryAssetId ?? '')
            saveStoredPrepareFirstVout(accountIndex, firstVout)
            setSavedPreparedTxid(txid)
            setSavedAuxiliaryAssetId(auxiliaryAssetId ?? null)
            setSavedPrepareFirstVout(firstVout)
            setShowPrepareModal(false)
            void refresh()
          }}
          onClose={() => setShowPrepareModal(false)}
        />
      </Modal>

      <Modal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title="Borrower settings"
      >
        <div className="space-y-4 text-sm">
          {savedPreparedTxid ? (
            <>
              <div>
                <p className="font-medium text-gray-700 mb-1">Prepare txid</p>
                <p className="font-mono text-xs break-all text-gray-800">{savedPreparedTxid}</p>
              </div>
              {savedAuxiliaryAssetId && (
                <div>
                  <p className="font-medium text-gray-700 mb-1">Auxiliary asset id</p>
                  <p className="font-mono text-xs break-all text-gray-800">
                    {savedAuxiliaryAssetId}
                  </p>
                </div>
              )}
              <div>
                <p className="font-medium text-gray-700 mb-1">First vout</p>
                <p className="font-mono text-xs text-gray-800">{savedPrepareFirstVout}</p>
              </div>
            </>
          ) : (
            <p className="text-gray-600">
              No prepare data. Use &quot;Prepare to be a borrower&quot; first.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={handleClearPrepare}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear prepare data
            </button>
            <button
              type="button"
              onClick={handlePrepareAgain}
              className="rounded-lg bg-[#5F3DC4] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4f36a8]"
            >
              Prepare again
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showCreateWizard}
        onClose={() => setShowCreateWizard(false)}
        title="Create Borrow Offer"
      >
        <CreateOfferWizard
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          savedPreparedTxid={savedPreparedTxid}
          savedAuxiliaryAssetId={savedAuxiliaryAssetId}
          savedPrepareFirstVout={savedPrepareFirstVout}
          currentBlockHeight={currentBlockHeight}
          onBroadcastSuccess={refresh}
          onComplete={() => setShowCreateWizard(false)}
          onIssueUtilityNftsSuccess={handleClearPrepare}
        />
      </Modal>
    </div>
  )
}
