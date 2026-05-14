import { normalizeHex } from '@/utils/hex'

import type { ListOffersParams } from './methods'

export const offersQueryKeys = {
  all: ['offers'] as const,
  list: ({ status, asset, limit, offset }: ListOffersParams) =>
    ['offers', 'list', status, asset, limit, offset] as const,
  detail: (offerId: string) => ['offers', 'detail', offerId] as const,
  utxos: (offerId: string) => ['offers', 'utxos', offerId] as const,
  participants: (offerId: string) => ['offers', 'participants', offerId] as const,
  participantsHistory: (offerId: string) => ['offers', 'participants-history', offerId] as const,
  byScript: (scriptPubkeyHex: string) =>
    ['offers', 'by-script', normalizeHex(scriptPubkeyHex)] as const,
  byBorrower: (borrowerPubkeyHex: string) =>
    ['offers', 'by-borrower', normalizeHex(borrowerPubkeyHex)] as const,
} as const
