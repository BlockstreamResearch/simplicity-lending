import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchOfferDetailsBatchWithParticipants,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScripts,
  fetchOffers,
  filterOffersByParticipantScripts,
} from '../../api/client'
import { EsploraClient } from '../../api/esplora'
import { OfferTable } from '../../components/OfferTable'
import type { OfferShort } from '../../types/offers'
import { mergeBorrowerOffers, summarizeBorrowerOffers } from '../../utility/borrowerOffers'
import type { WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'
import { loadTrackedBorrowerOfferIds } from '../../walletAbi/borrowerTrackedStorage'
import { loadTrackedLenderOfferIds } from '../../walletAbi/lenderStorage'
import { loadKnownWalletScripts } from '../../walletAbi/walletScriptStorage'

interface BorrowStats {
  lockedLbtc: bigint
  activeDeals: number
  pendingDeals: number
}

interface SupplyStats {
  activeOffers: number
  waitingLiquidation: number
}

const ZERO_BORROW_STATS: BorrowStats = {
  lockedLbtc: 0n,
  activeDeals: 0,
  pendingDeals: 0,
}

const ZERO_SUPPLY_STATS: SupplyStats = {
  activeOffers: 0,
  waitingLiquidation: 0,
}

function formatSats(value: bigint): string {
  const asNumber = Number(value)
  if (Number.isSafeInteger(asNumber)) {
    return asNumber.toLocaleString()
  }
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function StatCard({
  label,
  value,
  loading,
  accent,
}: {
  label: string
  value: string | number
  loading: boolean
  accent: string
}) {
  return (
    <div className="rounded-[1.75rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${accent}`}>
          {label.slice(0, 1)}
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
          {label}
        </p>
      </div>
      {loading ? (
        <div className="mt-4 h-10 w-28 animate-pulse rounded-full bg-neutral-200" aria-hidden />
      ) : (
        <p className="mt-4 text-3xl font-semibold tracking-tight text-neutral-950">{value}</p>
      )}
    </div>
  )
}

export function Dashboard({
  onTab,
  network,
  signerScriptPubkeyHex,
  signingXOnlyPubkey,
}: {
  onTab: (tab: 'dashboard' | 'borrower' | 'lender' | 'utility') => void
  network: WalletAbiNetwork
  signerScriptPubkeyHex: string
  signingXOnlyPubkey: string
}) {
  const esplora = useMemo(() => new EsploraClient(), [])
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<string | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [borrowStats, setBorrowStats] = useState<BorrowStats>(ZERO_BORROW_STATS)
  const [supplyStats, setSupplyStats] = useState<SupplyStats>(ZERO_SUPPLY_STATS)

  const loadOffers = useCallback(async () => {
    setOffersLoading(true)
    setOffersError(null)
    try {
      const [recentOffers, tipHeight] = await Promise.all([
        fetchOffers({ limit: 10, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setOffers(recentOffers)
      setCurrentBlockHeight(tipHeight)
    } catch (error) {
      setOffersError(error instanceof Error ? error.message : String(error))
      setOffers([])
    } finally {
      setOffersLoading(false)
    }
  }, [esplora])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const knownScripts = [
        signerScriptPubkeyHex,
        ...loadKnownWalletScripts(signingXOnlyPubkey, network),
      ]
      const trackedBorrowerOfferIds = loadTrackedBorrowerOfferIds(signingXOnlyPubkey, network)
      const trackedLenderOfferIds = loadTrackedLenderOfferIds(signingXOnlyPubkey, network)
      const [idsByScript, idsByBorrowerPubkey] = await Promise.all([
        fetchOfferIdsByScripts(knownScripts),
        fetchOfferIdsByBorrowerPubkey(signingXOnlyPubkey),
      ])
      const borrowerIds = [
        ...new Set([...idsByScript, ...trackedBorrowerOfferIds, ...idsByBorrowerPubkey]),
      ]
      const lenderIds = [...new Set([...idsByScript, ...trackedLenderOfferIds])]
      const [offersByScript, borrowerOffers] = await Promise.all([
        lenderIds.length === 0 ? Promise.resolve([]) : fetchOfferDetailsBatchWithParticipants(lenderIds),
        borrowerIds.length === 0
          ? Promise.resolve([])
          : fetchOfferDetailsBatchWithParticipants(borrowerIds),
      ])

      const allBorrowerOffers = mergeBorrowerOffers({
        detailedOffers: borrowerOffers,
        knownScripts,
        trackedOfferIds: trackedBorrowerOfferIds,
        pendingBorrowerPubkeyOfferIds: idsByBorrowerPubkey,
      })
      const lenderOffersByScript = filterOffersByParticipantScripts(offersByScript, knownScripts, 'lender')
      const lenderOffersByScriptIds = new Set(lenderOffersByScript.map((offer) => offer.id))
      const trackedLenderOffers = offersByScript
        .filter((offer) => trackedLenderOfferIds.includes(offer.id) && !lenderOffersByScriptIds.has(offer.id))
        .map(({ participants, ...offer }) => {
          void participants
          return offer
        })
      const lenderOffers = [...lenderOffersByScript, ...trackedLenderOffers]

      const borrowSummary = summarizeBorrowerOffers(allBorrowerOffers)
      const activeLenderOffers = lenderOffers.filter((offer) => offer.status === 'active')
      const waitingLiquidation =
        currentBlockHeight == null
          ? 0
          : activeLenderOffers.filter(
              (offer) => offer.loan_expiration_time <= currentBlockHeight
            ).length

      setBorrowStats(borrowSummary)
      setSupplyStats({
        activeOffers: activeLenderOffers.length - waitingLiquidation,
        waitingLiquidation,
      })
    } catch (error) {
      setStatsError(error instanceof Error ? error.message : String(error))
      setBorrowStats(ZERO_BORROW_STATS)
      setSupplyStats(ZERO_SUPPLY_STATS)
    } finally {
      setStatsLoading(false)
    }
  }, [currentBlockHeight, network, signerScriptPubkeyHex, signingXOnlyPubkey])

  useEffect(() => {
    void loadOffers()
  }, [loadOffers])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-neutral-200 bg-[linear-gradient(135deg,#f4efe6_0%,#ffffff_55%,#f6faf8_100%)] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.07)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-neutral-500">
              Public Lending View
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-950">
              Protocol state from the indexer, wallet actions through Wallet ABI.
            </h2>
            <p className="mt-4 text-base leading-7 text-neutral-600">
              The dashboard stays public-only: no private wallet balances, no UTXO inspection, and
              no seed-derived identity inside the browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onTab('borrower')}
              className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Borrower Flows
            </button>
            <button
              type="button"
              onClick={() => onTab('lender')}
              className="rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Lender Flows
            </button>
            <button
              type="button"
              onClick={() => onTab('utility')}
              className="rounded-full border border-sky-300 bg-sky-50 px-5 py-3 text-sm font-medium text-sky-900 hover:bg-sky-100"
            >
              Utility Demo
            </button>
          </div>
        </div>
        {statsError && (
          <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {statsError}
          </p>
        )}
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Borrowed LBTC Locked"
          value={`${formatSats(borrowStats.lockedLbtc)} sats`}
          loading={statsLoading}
          accent="bg-amber-100 text-amber-800"
        />
        <StatCard
          label="Borrower Active Deals"
          value={borrowStats.activeDeals}
          loading={statsLoading}
          accent="bg-emerald-100 text-emerald-800"
        />
        <StatCard
          label="Borrower Pending Deals"
          value={borrowStats.pendingDeals}
          loading={statsLoading}
          accent="bg-sky-100 text-sky-800"
        />
        <StatCard
          label="Supply Waiting Liquidation"
          value={supplyStats.waitingLiquidation}
          loading={statsLoading}
          accent="bg-rose-100 text-rose-800"
        />
      </section>

      <section className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
              Most Recent Offers
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
              Market snapshot
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void loadOffers()}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Refresh
          </button>
        </div>
        <OfferTable
          offers={offers}
          loading={offersLoading}
          error={offersError}
          currentBlockHeight={currentBlockHeight}
          onRetry={() => void loadOffers()}
          emptyMessage="No offers indexed yet"
        />
      </section>
    </div>
  )
}
