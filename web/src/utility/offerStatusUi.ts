import type { OfferStatus } from '../types/offers'

export type OfferStatusKey = OfferStatus | 'expired' | 'unknown'

export interface OfferStatusUi {
  label: string
  chipClassName: string
  textClassName: string
  dotClassName: string
}

const STATUS_UI: Record<OfferStatusKey, OfferStatusUi> = {
  pending: {
    label: 'Pending',
    chipClassName: 'bg-amber-100',
    textClassName: 'text-amber-700',
    dotClassName: 'bg-amber-500',
  },
  active: {
    label: 'Active',
    chipClassName: 'bg-green-100',
    textClassName: 'text-green-700',
    dotClassName: 'bg-green-500',
  },
  repaid: {
    label: 'Repaid',
    chipClassName: 'bg-sky-100',
    textClassName: 'text-sky-700',
    dotClassName: 'bg-sky-500',
  },
  claimed: {
    label: 'Claimed',
    chipClassName: 'bg-indigo-100',
    textClassName: 'text-indigo-700',
    dotClassName: 'bg-indigo-500',
  },
  liquidated: {
    label: 'Liquidated',
    chipClassName: 'bg-rose-100',
    textClassName: 'text-rose-700',
    dotClassName: 'bg-rose-500',
  },
  cancelled: {
    label: 'Cancelled',
    chipClassName: 'bg-gray-100',
    textClassName: 'text-gray-600',
    dotClassName: 'bg-gray-400',
  },
  expired: {
    label: 'Expired',
    chipClassName: 'bg-orange-100',
    textClassName: 'text-orange-700',
    dotClassName: 'bg-orange-500',
  },
  unknown: {
    label: 'Unknown',
    chipClassName: 'bg-slate-100',
    textClassName: 'text-slate-600',
    dotClassName: 'bg-slate-400',
  },
}

function normalizeStatus(status: string): OfferStatusKey {
  const s = status.trim().toLowerCase()
  if (s === 'canceled') return 'cancelled'
  if (s in STATUS_UI) return s as OfferStatusKey
  return 'unknown'
}

export function getOfferStatusUi(params: {
  status: OfferStatus | string
  loanExpirationTime?: number
  currentBlockHeight?: number | null
}): OfferStatusUi {
  const baseStatus = normalizeStatus(params.status)
  if (
    (baseStatus === 'active' || baseStatus === 'pending') &&
    params.currentBlockHeight != null &&
    typeof params.loanExpirationTime === 'number' &&
    params.loanExpirationTime <= params.currentBlockHeight
  ) {
    return STATUS_UI.expired
  }
  return STATUS_UI[baseStatus]
}
