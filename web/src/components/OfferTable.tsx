/**
 * Shared table for offers: 8 columns (Offer ID, COLLATERAL ASSET, PRINCIPAL,
 * Collateral amount, Principal amount, Interest rate, Expiration, Status).
 * Used on Dashboard and Borrower page.
 */

import { useMemo } from 'react'
import { EsploraClient } from '../api/esplora'
import type { OfferShort } from '../types/offers'

const BLOCKS_PER_DAY_LIQUID = 1440
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

function shortId(id: string, len = 12): string {
  if (!id || id.length <= len) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}

function formatSats(amount: bigint): string {
  const s = String(amount)
  if (amount <= BigInt(MAX_SAFE_INTEGER)) return Number(amount).toLocaleString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatInTime(blocksLeft: number): string {
  if (blocksLeft <= 0) return 'Expired'
  if (blocksLeft < 60) return `in ~${blocksLeft} min`
  if (blocksLeft < BLOCKS_PER_DAY_LIQUID) return `in ~${Math.round(blocksLeft / 60)} h`
  return `in ~${Math.round(blocksLeft / BLOCKS_PER_DAY_LIQUID)} days`
}

function formatExpiryTime(
  loanExpirationTime: number,
  currentBlockHeight: number | null
): { timeStr: string; inTimeStr: string | null } {
  if (currentBlockHeight == null) {
    return { timeStr: `Block ${loanExpirationTime.toLocaleString()}`, inTimeStr: null }
  }
  const blocksLeft = loanExpirationTime - currentBlockHeight
  const estimatedMs = blocksLeft * 60 * 1000
  const date = new Date(Date.now() + estimatedMs)
  const timeStr = date.toLocaleString()
  const inTimeStr = formatInTime(blocksLeft)
  return { timeStr, inTimeStr }
}

export interface OfferTableProps {
  offers: OfferShort[]
  loading: boolean
  error: string | null
  currentBlockHeight: number | null
  onRetry?: () => void
  emptyMessage?: string
}

export function OfferTable({
  offers,
  loading,
  error,
  currentBlockHeight,
  onRetry,
  emptyMessage = 'No offers yet',
}: OfferTableProps) {
  const esplora = useMemo(() => new EsploraClient(), [])

  return (
    <>
      {error != null && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          {onRetry != null && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-2 font-medium underline hover:no-underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                Offer ID <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                COLLATERAL ASSET <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                PRINCIPAL <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                Collateral amount <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                Principal amount <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                Interest rate <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                Expiration <span className="text-gray-400">↕</span>
              </th>
              <th className="py-2 px-3 text-left text-sm font-semibold text-gray-700">
                Status <span className="text-gray-400">↕</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className="border-t border-gray-200">
                <td colSpan={8} className="py-6 px-3 text-center text-sm text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && offers.length === 0 && !error && (
              <tr className="border-t border-gray-200">
                <td colSpan={8} className="py-6 px-3 text-center text-sm text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading &&
              offers.length > 0 &&
              offers.map((offer) => {
                const expiry = formatExpiryTime(offer.loan_expiration_time, currentBlockHeight)
                const interestPercent = (offer.interest_rate / 100).toFixed(2)
                const statusLabel = offer.status.charAt(0).toUpperCase() + offer.status.slice(1)
                return (
                  <tr key={offer.id} className="border-t border-gray-200">
                    <td className="py-2 px-3 text-sm font-mono text-gray-900">
                      {shortId(offer.id)}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-900">
                      <a
                        href={esplora.getAssetExplorerUrl(offer.collateral_asset)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[#5F3DC4] hover:underline"
                      >
                        {shortId(offer.collateral_asset)}
                      </a>
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-900">
                      <a
                        href={esplora.getAssetExplorerUrl(offer.principal_asset)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[#5F3DC4] hover:underline"
                      >
                        {shortId(offer.principal_asset)}
                      </a>
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-900 tabular-nums">
                      {formatSats(offer.collateral_amount)}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-900 tabular-nums">
                      {formatSats(offer.principal_amount)}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-900">{interestPercent}%</td>
                    <td className="py-2 px-3 text-sm text-gray-900">
                      <span className="block">{expiry.timeStr}</span>
                      {expiry.inTimeStr != null && (
                        <span className="block text-gray-500">{expiry.inTimeStr}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-900">{statusLabel}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </>
  )
}
