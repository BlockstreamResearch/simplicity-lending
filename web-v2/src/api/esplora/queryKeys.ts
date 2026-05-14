export const esploraQueryKeys = {
  all: ['esplora'] as const,
  blockHeight: ['esplora', 'block', 'height'] as const,
  blockHash: (blockHeight: number) => ['esplora', 'block', 'hash', blockHeight] as const,
  tx: (txId: string) => ['esplora', 'tx', txId] as const,
  txOutspends: (txId: string) => ['esplora', 'tx', txId, 'outspends'] as const,
  addressInfo: (address: string) => ['esplora', 'address', address, 'info'] as const,
  addressUtxo: (address: string) => ['esplora', 'address', address, 'utxo'] as const,
  addressTxs: (address: string, lastSeenTxId?: string) =>
    ['esplora', 'address', address, 'txs', lastSeenTxId] as const,
} as const
