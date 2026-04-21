import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchOfferDetailsBatchWithParticipants,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScript,
  fetchOffers,
  filterOffersByParticipantRole,
} from '../api/client'
import { EsploraClient } from '../api/esplora'
import { OfferTable } from '../components/OfferTable'
import type { OfferShort } from '../types/offers'
import { getScriptPubkeyHexFromAddress } from '../utility/addressP2pk'
import { useWalletAbiSession } from '../walletAbi/session'
import { loadLenderFlowState, trackLenderScriptPubkey } from '../walletAbi/storage'
import { RouteScaffold } from './RouteScaffold'

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent: string
}) {
  return (
    <div className="rounded-[1.75rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${accent}`}
        >
          {label.slice(0, 1)}
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
          {label}
        </p>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{value}</p>
    </div>
  )
}

function countOffers(offers: OfferShort[], status: OfferShort['status']) {
  return offers.filter((offer) => offer.status === status).length
}

function PersonalOrdersPlaceholder({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-5 py-10 text-center text-sm text-neutral-600">
      {message}
    </div>
  )
}

export function DashboardRoute() {
  const session = useWalletAbiSession()
  const esplora = useMemo(() => new EsploraClient(), [])

  const [borrowOffers, setBorrowOffers] = useState<OfferShort[]>([])
  const [supplyOffers, setSupplyOffers] = useState<OfferShort[]>([])
  const [pendingOffers, setPendingOffers] = useState<OfferShort[]>([])
  const [allOffers, setAllOffers] = useState<OfferShort[]>([])

  const [loadingBorrow, setLoadingBorrow] = useState(false)
  const [loadingSupply, setLoadingSupply] = useState(false)
  const [loadingPending, setLoadingPending] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)

  const [borrowError, setBorrowError] = useState<string | null>(null)
  const [supplyError, setSupplyError] = useState<string | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [allError, setAllError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)

  const walletReady = session.status === 'connected' && Boolean(session.receiveAddress)
  const borrowerReady = walletReady && Boolean(session.signingXOnlyPubkey)
  const lenderIdentity = session.signingXOnlyPubkey ?? session.receiveAddress

  const loadBorrowOffers = useCallback(async () => {
    if (!session.receiveAddress || !session.signingXOnlyPubkey) {
      setBorrowOffers([])
      setBorrowError(null)
      setLoadingBorrow(false)
      return
    }

    setLoadingBorrow(true)
    setBorrowError(null)

    try {
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(session.receiveAddress)
      const [idsByScript, idsByBorrowerPubkey, height] = await Promise.all([
        fetchOfferIdsByScript(scriptPubkeyHex),
        fetchOfferIdsByBorrowerPubkey(session.signingXOnlyPubkey),
        esplora.getLatestBlockHeight().catch(() => null),
      ])

      const mergedIds = [...new Set([...idsByScript, ...idsByBorrowerPubkey])]
      const offersWithParticipants =
        mergedIds.length === 0 ? [] : await fetchOfferDetailsBatchWithParticipants(mergedIds)

      const borrowerByScript = filterOffersByParticipantRole(
        offersWithParticipants,
        scriptPubkeyHex,
        'borrower'
      )
      const borrowerByScriptIds = new Set(borrowerByScript.map((offer) => offer.id))
      const pendingByPubkey = offersWithParticipants
        .filter(
          (offer) => idsByBorrowerPubkey.includes(offer.id) && !borrowerByScriptIds.has(offer.id)
        )
        .map(({ participants, ...offer }) => {
          void participants
          return offer
        })

      setBorrowOffers([...borrowerByScript, ...pendingByPubkey])
      setCurrentBlockHeight(height)
    } catch (nextError) {
      setBorrowError(nextError instanceof Error ? nextError.message : String(nextError))
      setBorrowOffers([])
    } finally {
      setLoadingBorrow(false)
    }
  }, [esplora, session.receiveAddress, session.signingXOnlyPubkey])

  const loadSupplyOffers = useCallback(async () => {
    if (!session.receiveAddress) {
      setSupplyOffers([])
      setSupplyError(null)
      setLoadingSupply(false)
      return
    }

    setLoadingSupply(true)
    setSupplyError(null)

    try {
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(session.receiveAddress)
      const lenderState = trackLenderScriptPubkey(lenderIdentity, scriptPubkeyHex)
      const scriptPubkeys = [
        ...new Set(
          [scriptPubkeyHex, ...lenderState.scriptPubkeys].map((script) => script.toLowerCase())
        ),
      ]

      const [idsByScript, height, activeOffers] = await Promise.all([
        Promise.all(scriptPubkeys.map((script) => fetchOfferIdsByScript(script))),
        esplora.getLatestBlockHeight().catch(() => null),
        fetchOffers({ status: 'active', limit: 20, offset: 0 }).catch(() => []),
      ])
      const storedOfferIds = loadLenderFlowState(lenderIdentity).offerIds
      const ids = [...new Set([...idsByScript.flat(), ...storedOfferIds])]
      const offersWithParticipants =
        ids.length === 0 ? [] : await fetchOfferDetailsBatchWithParticipants(ids)

      const scriptSet = new Set(scriptPubkeys)
      const offerById = new Map<string, OfferShort>()
      for (const offer of offersWithParticipants) {
        const isKnownLender = offer.participants.some(
          (participant) =>
            participant.participant_type === 'lender' &&
            scriptSet.has(participant.script_pubkey.trim().toLowerCase())
        )
        if (isKnownLender || storedOfferIds.includes(offer.id)) {
          offerById.set(offer.id, offer)
        }
      }

      if (offerById.size === 0 && height != null) {
        for (const offer of activeOffers) {
          if (offer.loan_expiration_time <= height) {
            offerById.set(offer.id, offer)
          }
        }
      }

      setSupplyOffers([...offerById.values()])
      setCurrentBlockHeight((current) => height ?? current)
    } catch (nextError) {
      setSupplyError(nextError instanceof Error ? nextError.message : String(nextError))
      setSupplyOffers([])
    } finally {
      setLoadingSupply(false)
    }
  }, [esplora, lenderIdentity, session.receiveAddress])

  const loadPendingOffers = useCallback(async () => {
    setLoadingPending(true)
    setPendingError(null)

    try {
      const [offers, height] = await Promise.all([
        fetchOffers({ status: 'pending', limit: 20, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setPendingOffers(offers)
      setCurrentBlockHeight((current) => height ?? current)
    } catch (nextError) {
      setPendingError(nextError instanceof Error ? nextError.message : String(nextError))
      setPendingOffers([])
    } finally {
      setLoadingPending(false)
    }
  }, [esplora])

  const loadAllOffers = useCallback(async () => {
    setLoadingAll(true)
    setAllError(null)

    try {
      const [offers, height] = await Promise.all([
        fetchOffers({ limit: 100, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setAllOffers(offers)
      setCurrentBlockHeight((current) => height ?? current)
    } catch (nextError) {
      setAllError(nextError instanceof Error ? nextError.message : String(nextError))
      setAllOffers([])
    } finally {
      setLoadingAll(false)
    }
  }, [esplora])

  useEffect(() => {
    void loadBorrowOffers()
  }, [loadBorrowOffers])

  useEffect(() => {
    void loadSupplyOffers()
  }, [loadSupplyOffers])

  useEffect(() => {
    void loadPendingOffers()
  }, [loadPendingOffers])

  useEffect(() => {
    void loadAllOffers()
  }, [loadAllOffers])

  return (
    <div className="space-y-8">
      <RouteScaffold
        eyebrow="Dashboard"
        title="Orders"
        description="Market orders are always visible. Connect the wallet in the top-right to load your positions."
      >
        {session.error ? (
          <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {session.error}
          </p>
        ) : null}
      </RouteScaffold>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Borrow Pending"
          value={countOffers(borrowOffers, 'pending')}
          accent="bg-amber-100 text-amber-800"
        />
        <StatCard
          label="Borrow Active"
          value={countOffers(borrowOffers, 'active')}
          accent="bg-emerald-100 text-emerald-800"
        />
        <StatCard
          label="Supply Active"
          value={countOffers(supplyOffers, 'active')}
          accent="bg-sky-100 text-sky-800"
        />
        <StatCard
          label="Market Pending"
          value={pendingOffers.length}
          accent="bg-rose-100 text-rose-800"
        />
      </section>

      <section className="space-y-5">
        <div className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                Your Borrows
              </p>
            </div>
            <Link
              to="/borrower"
              className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Open Borrower
            </Link>
          </div>
          {borrowerReady ? (
            <OfferTable
              offers={borrowOffers}
              loading={loadingBorrow}
              error={borrowError}
              currentBlockHeight={currentBlockHeight}
              onRetry={loadBorrowOffers}
              emptyMessage="No borrower positions yet."
            />
          ) : (
            <PersonalOrdersPlaceholder message="Connect wallet to load your borrower positions." />
          )}
        </div>

        <div className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                Your Supply
              </p>
            </div>
            <Link
              to="/lender"
              className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Open Lender
            </Link>
          </div>
          {walletReady ? (
            <OfferTable
              offers={supplyOffers}
              loading={loadingSupply}
              error={supplyError}
              currentBlockHeight={currentBlockHeight}
              onRetry={loadSupplyOffers}
              emptyMessage="No lender positions yet."
            />
          ) : (
            <PersonalOrdersPlaceholder message="Connect wallet to load your supply." />
          )}
        </div>
      </section>

      <section className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
              Pending Market Orders
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPendingOffers()}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Refresh
          </button>
        </div>
        <OfferTable
          offers={pendingOffers}
          loading={loadingPending}
          error={pendingError}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadPendingOffers}
          emptyMessage="No pending market orders are available right now."
        />
      </section>

      <section className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
              All Orders
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAllOffers()}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Refresh
          </button>
        </div>
        <OfferTable
          offers={allOffers}
          loading={loadingAll}
          error={allError}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadAllOffers}
          emptyMessage="No orders are available yet."
        />
      </section>
    </div>
  )
}
