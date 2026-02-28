/**
 * Lender page: balance cards (LBTC, USDT), YOUR SUPPLY table (offers where user is lender),
 * PENDING OFFERS YOU CAN ACCEPT. Data from Indexer API (by-script + batch for supply, fetchOffers status=pending for pending).
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import type { Tab } from '../../App'
import { useSeedHex } from '../../SeedContext'
import { useAccountAddress } from '../../hooks/useAccountAddress'
import {
  fetchOffers,
  fetchOfferIdsByScript,
  fetchOfferDetailsBatchWithParticipants,
  filterOffersByParticipantRole,
} from '../../api/client'
import { EsploraClient } from '../../api/esplora'
import { getScriptPubkeyHexFromAddress } from '../../utility/addressP2pk'
import { OfferTable } from '../../components/OfferTable'
import { AcceptOfferModal } from './AcceptOfferModal'
import { LiquidationModal } from './LiquidationModal'
import type { OfferShort } from '../../types/offers'

export function LenderPage({
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
  } = useAccountAddress({
    seedHex,
    accountIndex,
    esplora,
  })

  const [lendOffers, setLendOffers] = useState<OfferShort[]>([])
  const [lendLoading, setLendLoading] = useState(true)
  const [lendError, setLendError] = useState<string | null>(null)
  const [pendingOffers, setPendingOffers] = useState<OfferShort[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)
  const [acceptModalOpen, setAcceptModalOpen] = useState(false)
  const [liquidationOffer, setLiquidationOffer] = useState<OfferShort | null>(null)
  const [liquidationModalOpen, setLiquidationModalOpen] = useState(false)

  const loadLendOffers = useCallback(async () => {
    if (!accountAddress) {
      setLendOffers([])
      setLendLoading(false)
      return
    }
    setLendLoading(true)
    setLendError(null)
    try {
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(accountAddress)
      const ids = await fetchOfferIdsByScript(scriptPubkeyHex)
      const [withParticipants, height] = await Promise.all([
        ids.length === 0 ? Promise.resolve([]) : fetchOfferDetailsBatchWithParticipants(ids),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      const list = filterOffersByParticipantRole(withParticipants, scriptPubkeyHex, 'lender')
      setLendOffers(list)
      setCurrentBlockHeight(height)
    } catch (e) {
      setLendError(e instanceof Error ? e.message : String(e))
      setLendOffers([])
    } finally {
      setLendLoading(false)
    }
  }, [accountAddress, esplora])

  const loadPendingOffers = useCallback(async () => {
    setPendingLoading(true)
    setPendingError(null)
    try {
      const [list, height] = await Promise.all([
        fetchOffers({ status: 'pending', limit: 10, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setPendingOffers(list)
      setCurrentBlockHeight((h) => h ?? height)
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : String(e))
      setPendingOffers([])
    } finally {
      setPendingLoading(false)
    }
  }, [esplora])

  useEffect(() => {
    loadLendOffers()
  }, [loadLendOffers])

  useEffect(() => {
    loadPendingOffers()
  }, [loadPendingOffers])

  if (!seedHex) {
    return <p className="text-gray-600">Connect seed to view lender offers.</p>
  }

  if (loading) {
    return <p className="text-gray-600">Loading…</p>
  }

  if (error) {
    return <p className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p>
  }

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={() => onTab('dashboard')}
        className="flex items-center gap-1 rounded-lg bg-[#5F3DC4] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4f36a8]"
      >
        <span aria-hidden>&lt;</span>
        <span>Back to Dashboard</span>
      </button>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-xs font-medium text-teal-700">
              L
            </span>
            <h2 className="text-base font-semibold text-gray-900">LBTC</h2>
          </div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm uppercase text-gray-500">COMPLETE BALANCE LBTC</span>
            <span className="text-sm font-medium text-green-600">24H +2.3%</span>
          </div>
          <p className="mb-1 text-2xl font-bold text-gray-900">0.00</p>
          <p className="mb-4 text-sm text-gray-500">$0.00 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">LOAN COLLATERAL:</span>{' '}
            <span className="text-gray-600">0 LBTC</span>
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700">
              U
            </span>
            <h2 className="text-base font-semibold text-gray-900">USDT</h2>
          </div>
          <div className="mb-2 text-sm uppercase text-gray-500">COMPLETE BALANCE USDT</div>
          <p className="mb-1 text-2xl font-bold text-gray-900">60,000.00</p>
          <p className="mb-4 text-sm text-gray-500">$59,914.89 USD</p>
          <p className="text-sm text-gray-500">
            <span className="uppercase">SUPPLIED:</span>{' '}
            <span className="text-gray-600">50,000 USDT</span>
          </p>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-gray-500" aria-hidden>
            &#9650;
          </span>
          <h3 className="text-base font-semibold uppercase text-gray-900">YOUR SUPPLY</h3>
        </div>
        <OfferTable
          offers={lendOffers}
          loading={lendLoading}
          error={lendError}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadLendOffers}
          emptyMessage="No supply yet"
          onOfferClick={(offer) => {
            const expired =
              currentBlockHeight != null && offer.loan_expiration_time <= currentBlockHeight
            if (expired) {
              setLiquidationOffer(offer)
              setLiquidationModalOpen(true)
            }
          }}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-gray-500">★</span>
          <h3 className="text-base font-semibold text-gray-900">PENDING OFFERS YOU CAN ACCEPT</h3>
        </div>
        <OfferTable
          offers={pendingOffers}
          loading={pendingLoading}
          error={pendingError}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadPendingOffers}
          emptyMessage="No pending offers"
          onOfferClick={(offer) => {
            setSelectedOffer(offer)
            setAcceptModalOpen(true)
          }}
        />
      </section>

      {selectedOffer && (
        <AcceptOfferModal
          offer={selectedOffer}
          utxos={utxos}
          esplora={esplora}
          open={acceptModalOpen}
          onClose={() => {
            setAcceptModalOpen(false)
            setSelectedOffer(null)
          }}
          currentBlockHeight={currentBlockHeight}
          seedHex={seedHex ?? undefined}
          accountIndex={accountIndex}
        />
      )}

      {liquidationOffer && (
        <LiquidationModal
          offer={liquidationOffer}
          utxos={utxos}
          esplora={esplora}
          open={liquidationModalOpen}
          onClose={() => {
            setLiquidationModalOpen(false)
            setLiquidationOffer(null)
          }}
          currentBlockHeight={currentBlockHeight}
          accountAddress={accountAddress}
          seedHex={seedHex ?? undefined}
          accountIndex={accountIndex}
          onSuccess={loadLendOffers}
        />
      )}
    </div>
  )
}
