/**
 * Dashboard: YOUR BORROWS / YOUR SUPPLY cards and MOST RECENT 10 SUPPLY OFFERS table.
 * Borrow button → Borrower tab; Supply button → Lender tab.
 * Offers are loaded from Indexer API (GET /offers).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tab } from '../../App'
import { useSeedHex } from '../../SeedContext'
import {
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScript,
  fetchOfferDetailsBatchWithParticipants,
  fetchOffers,
  filterOffersByParticipantRole,
} from '../../api/client'
import { EsploraClient } from '../../api/esplora'
import { OfferTable } from '../../components/OfferTable'
import type { OfferShort } from '../../types/offers'
import { getScriptPubkeyHexFromAddress, getP2pkAddressFromSecret, P2PK_NETWORK } from '../../utility/addressP2pk'
import { POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { deriveSecretKeyFromIndex, parseSeedHex } from '../../utility/seed'

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

function formatBigint(value: bigint): string {
  const s = value.toString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function StatValue({
  loading,
  value,
  emphasize = false,
}: {
  loading: boolean
  value: string | number
  emphasize?: boolean
}) {
  if (loading) {
    return <div className="mt-2 h-9 w-28 animate-pulse rounded-lg bg-gray-200" aria-hidden="true" />
  }
  return (
    <p
      className={
        emphasize
          ? 'mt-1 text-3xl md:text-4xl font-bold leading-tight text-gray-900'
          : 'mt-1 text-2xl md:text-3xl font-semibold leading-tight text-gray-900'
      }
    >
      {value}
    </p>
  )
}

export function Dashboard({
  onTab,
  accountIndex,
}: {
  onTab: (t: Tab) => void
  accountIndex: number
}) {
  const seedHex = useSeedHex()
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [borrowStats, setBorrowStats] = useState<BorrowStats>(ZERO_BORROW_STATS)
  const [supplyStats, setSupplyStats] = useState<SupplyStats>(ZERO_SUPPLY_STATS)

  const esplora = useMemo(() => new EsploraClient(), [])

  const loadOffers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, height] = await Promise.all([
        fetchOffers({ limit: 10, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setOffers(list)
      setCurrentBlockHeight(height)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOffers([])
    } finally {
      setLoading(false)
    }
  }, [esplora])

  const loadStats = useCallback(async () => {
    if (!seedHex) {
      setBorrowStats(ZERO_BORROW_STATS)
      setSupplyStats(ZERO_SUPPLY_STATS)
      setStatsError(null)
      setStatsLoading(false)
      return
    }
    setStatsLoading(true)
    setStatsError(null)
    try {
      const seed = parseSeedHex(seedHex)
      const secretKey = deriveSecretKeyFromIndex(seed, accountIndex)
      const { address, internalKeyHex } = await getP2pkAddressFromSecret(secretKey, P2PK_NETWORK)
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(address)

      const [idsByScript, idsByBorrowerPubkey] = await Promise.all([
        fetchOfferIdsByScript(scriptPubkeyHex),
        fetchOfferIdsByBorrowerPubkey(internalKeyHex),
      ])

      const allBorrowerIds = [...new Set([...idsByScript, ...idsByBorrowerPubkey])]
      const [scriptOffersWithParticipants, borrowerOffersWithParticipants] = await Promise.all([
        idsByScript.length === 0 ? Promise.resolve([]) : fetchOfferDetailsBatchWithParticipants(idsByScript),
        allBorrowerIds.length === 0
          ? Promise.resolve([])
          : fetchOfferDetailsBatchWithParticipants(allBorrowerIds),
      ])

      const borrowerOffersByScript = filterOffersByParticipantRole(
        borrowerOffersWithParticipants,
        scriptPubkeyHex,
        'borrower'
      )
      const borrowerOffersByScriptIds = new Set(borrowerOffersByScript.map((o) => o.id))
      const borrowerPendingByPubkey = borrowerOffersWithParticipants.filter(
        (o) => idsByBorrowerPubkey.includes(o.id) && !borrowerOffersByScriptIds.has(o.id)
      )
      const borrowerPendingAsShort: OfferShort[] = borrowerPendingByPubkey.map(
        (offerWithParticipants) => {
          const { participants, ...offer } = offerWithParticipants
          void participants
          return offer
        }
      )
      const allBorrowerOffers = [...borrowerOffersByScript, ...borrowerPendingAsShort]

      const lenderOffers = filterOffersByParticipantRole(
        scriptOffersWithParticipants,
        scriptPubkeyHex,
        'lender'
      )

      const policyAssetId = POLICY_ASSET_ID[P2PK_NETWORK].trim().toLowerCase()
      const activeBorrowOffers = allBorrowerOffers.filter((o) => o.status === 'active')
      const lockedLbtc = activeBorrowOffers.reduce((sum, offer) => {
        const isLbtc = offer.collateral_asset.trim().toLowerCase() === policyAssetId
        return isLbtc ? sum + offer.collateral_amount : sum
      }, 0n)
      const pendingDeals = allBorrowerOffers.filter((o) => o.status === 'pending').length

      const activeLenderOffers = lenderOffers.filter((o) => o.status === 'active')
      const waitingLiquidation =
        currentBlockHeight == null
          ? 0
          : activeLenderOffers.filter((o) => o.loan_expiration_time <= currentBlockHeight).length
      const activeOffers = activeLenderOffers.length - waitingLiquidation

      setBorrowStats({
        lockedLbtc,
        activeDeals: activeBorrowOffers.length,
        pendingDeals,
      })
      setSupplyStats({
        activeOffers,
        waitingLiquidation,
      })
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : String(e))
      setBorrowStats(ZERO_BORROW_STATS)
      setSupplyStats(ZERO_SUPPLY_STATS)
    } finally {
      setStatsLoading(false)
    }
  }, [seedHex, accountIndex, currentBlockHeight])

  useEffect(() => {
    loadOffers()
  }, [loadOffers])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-stretch">
        <div className="flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
              B
            </span>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-800">
              Your Borrows
            </h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">LBTC Locked</p>
                <StatValue
                  loading={statsLoading}
                  value={`${formatBigint(borrowStats.lockedLbtc)} sats`}
                  emphasize
                />
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Active Deals</p>
                <StatValue loading={statsLoading} value={borrowStats.activeDeals} />
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Pending Deals</p>
                <StatValue loading={statsLoading} value={borrowStats.pendingDeals} />
              </div>
            </div>
            <div className="min-h-0 flex-1" aria-hidden="true" />
          </div>
          {statsError && (
            <p className="mt-4 mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {statsError}
            </p>
          )}
          <button
            type="button"
            onClick={() => onTab('borrower')}
            className="mt-4 w-full rounded-xl bg-[#5F3DC4] px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#4f36a8] hover:shadow-sm"
          >
            Borrow
          </button>
        </div>

        <div className="flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
              S
            </span>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-800">
              Your Supply
            </h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Active Offers</p>
                <StatValue loading={statsLoading} value={supplyStats.activeOffers} emphasize />
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Expecting Liquidation</p>
                <StatValue loading={statsLoading} value={supplyStats.waitingLiquidation} />
              </div>
            </div>
            <div className="min-h-0 flex-1" aria-hidden="true" />
          </div>
          {statsError && (
            <p className="mt-4 mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {statsError}
            </p>
          )}
          <button
            type="button"
            onClick={() => onTab('lender')}
            className="mt-4 w-full rounded-xl bg-[#5F3DC4] px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-[#4f36a8] hover:shadow-sm"
          >
            Supply
          </button>
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
            Recent
          </span>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-800">
            Most Recent 10 Supply Offers
          </h3>
        </div>
        <OfferTable
          offers={offers}
          loading={loading}
          error={error}
          currentBlockHeight={currentBlockHeight}
          onRetry={loadOffers}
          emptyMessage="No offers yet"
        />
        <div className="mt-3 flex justify-center gap-2 text-sm">
          <button
            type="button"
            className="rounded-xl border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Previous page"
            disabled
          >
            &lt;
          </button>
          <span className="rounded-xl border border-[#5F3DC4] bg-[#5F3DC4] px-2.5 py-1.5 text-sm font-semibold text-white">
            1
          </span>
          <button
            type="button"
            className="rounded-xl border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Next page"
            disabled
          >
            &gt;
          </button>
        </div>
      </section>
    </div>
  )
}
