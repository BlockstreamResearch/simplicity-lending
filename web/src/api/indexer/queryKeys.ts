import { normalizeHex } from '@/utils/hex'

import { type ListOffersParams, toQueryParams } from './methods'

export const offersQueryKeys = {
  all: () => ['offers'] as const,
  list: (params: ListOffersParams) => ['offers', 'list', toQueryParams(params)] as const,
  detail: (offerId: string) => ['offers', 'detail', offerId] as const,
  overview: () => ['offers', 'overview'] as const,
} as const

export const borrowerQueryKeys = {
  all: () => ['borrower'] as const,
  overview: (scriptPubkeyHex: string) =>
    ['borrower', 'overview', normalizeHex(scriptPubkeyHex)] as const,
  offers: (scriptPubkeyHex: string, params: ListOffersParams = {}) =>
    ['borrower', 'offers', normalizeHex(scriptPubkeyHex), toQueryParams(params)] as const,
} as const

export const lenderQueryKeys = {
  all: () => ['lender'] as const,
  overview: (scriptPubkeyHex: string) =>
    ['lender', 'overview', normalizeHex(scriptPubkeyHex)] as const,
  offers: (scriptPubkeyHex: string, params: ListOffersParams = {}) =>
    ['lender', 'offers', normalizeHex(scriptPubkeyHex), toQueryParams(params)] as const,
} as const

export const factoryQueryKeys = {
  all: () => ['factories'] as const,
  byScript: (scriptPubkeyHex: string) =>
    ['factories', 'by-script', normalizeHex(scriptPubkeyHex)] as const,
  detail: (factoryId: string) => ['factories', 'detail', factoryId] as const,
} as const
