import { normalizeHex } from '@/utils/hex'

import type { ListOffersParams } from './methods'

export const offersQueryKeys = {
  all: ['offers'] as const,
  list: (params: ListOffersParams) =>
    [
      'offers',
      'list',
      params.status,
      params.factoryId,
      params.asset,
      params.limit,
      params.offset,
      params.sortBy,
      params.sortDir,
    ] as const,
  detail: (offerId: string) => ['offers', 'detail', offerId] as const,
  byScript: (scriptPubkeyHex: string) =>
    ['offers', 'by-script', normalizeHex(scriptPubkeyHex)] as const,
} as const

export const borrowerQueryKeys = {
  byScript: (scriptPubkeyHex: string, params: ListOffersParams = {}) =>
    [
      'borrower',
      'by-script',
      normalizeHex(scriptPubkeyHex),
      params.limit,
      params.offset,
      params.status,
    ] as const,
} as const

export const factoryQueryKeys = {
  byScript: (scriptPubkeyHex: string) =>
    ['factories', 'by-script', normalizeHex(scriptPubkeyHex)] as const,
  detail: (factoryId: string) => ['factories', 'detail', factoryId] as const,
} as const
