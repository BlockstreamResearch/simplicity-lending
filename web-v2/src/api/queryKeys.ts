import { normalizeHex } from '@/utils/hex'

import type { ListOffersParams } from './indexer'

export const queryKeys = {
  offers: {
    all: ['offers'] as const,
    list: (params: ListOffersParams = {}) => ['offers', 'list', params] as const,
    detail: (offerId: string) => ['offers', 'detail', offerId] as const,
    utxos: (offerId: string) => ['offers', 'utxos', offerId] as const,
    participants: (offerId: string) => ['offers', 'participants', offerId] as const,
    participantsHistory: (offerId: string) => ['offers', 'participants-history', offerId] as const,
    byScript: (scriptPubkeyHex: string) =>
      ['offers', 'by-script', normalizeHex(scriptPubkeyHex)] as const,
    byBorrower: (borrowerPubkeyHex: string) =>
      ['offers', 'by-borrower', normalizeHex(borrowerPubkeyHex)] as const,
  },
  esplora: {
    all: ['esplora'] as const,
    blockHeight: ['esplora', 'block', 'height'] as const,
    blockHash: (blockHeight: number) => ['esplora', 'block', 'hash', blockHeight] as const,
    tx: (txid: string) => ['esplora', 'tx', txid] as const,
    txOutspends: (txid: string) => ['esplora', 'tx', txid, 'outspends'] as const,
    addressInfo: (address: string) => ['esplora', 'address', address, 'info'] as const,
    addressUtxo: (address: string) => ['esplora', 'address', address, 'utxo'] as const,
    addressTxs: (address: string, lastSeenTxid?: string) =>
      ['esplora', 'address', address, 'txs', lastSeenTxid] as const,
  },
} as const
