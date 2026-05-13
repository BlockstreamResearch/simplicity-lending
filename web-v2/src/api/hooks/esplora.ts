import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'

import type { ApiError } from '../errors'
import {
  broadcastTx,
  getAddressInfo,
  getAddressTxs,
  getAddressUtxo,
  getBlockHashAtHeight,
  getLatestBlockHeight,
  getTx,
  getTxOutspends,
} from '../esplora'
import { queryKeys } from '../queryKeys'
import type {
  AddressInfo,
  EsploraOutspend,
  EsploraTx,
  ScripthashTxEntry,
  ScripthashUtxoEntry,
} from '../schemas'
import { GC_TIME_MS, STALE_TIME_MS } from './staleTime'

const DEFAULT_BLOCK_HEIGHT_POLL_MS = 30_000

export function useTx(txid: string): UseQueryResult<EsploraTx> {
  return useQuery({
    queryKey: queryKeys.esplora.tx(txid),
    queryFn: ({ signal }) => getTx(txid, { signal }),
    staleTime: STALE_TIME_MS.long,
    gcTime: GC_TIME_MS.long,
    enabled: txid.length > 0,
  })
}

export function useTxOutspends(txid: string): UseQueryResult<EsploraOutspend[]> {
  return useQuery({
    queryKey: queryKeys.esplora.txOutspends(txid),
    queryFn: ({ signal }) => getTxOutspends(txid, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: txid.length > 0,
  })
}

export function useAddressInfo(address: string): UseQueryResult<AddressInfo> {
  return useQuery({
    queryKey: queryKeys.esplora.addressInfo(address),
    queryFn: ({ signal }) => getAddressInfo(address, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: address.length > 0,
  })
}

export function useAddressUtxos(address: string): UseQueryResult<ScripthashUtxoEntry[]> {
  return useQuery({
    queryKey: queryKeys.esplora.addressUtxo(address),
    queryFn: ({ signal }) => getAddressUtxo(address, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: address.length > 0,
  })
}

export function useAddressTxs(
  address: string,
  lastSeenTxid?: string,
): UseQueryResult<ScripthashTxEntry[]> {
  return useQuery({
    queryKey: queryKeys.esplora.addressTxs(address, lastSeenTxid),
    queryFn: ({ signal }) => getAddressTxs(address, lastSeenTxid, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: address.length > 0,
  })
}

export function useBlockHeight(
  refetchIntervalMs: number = DEFAULT_BLOCK_HEIGHT_POLL_MS,
): UseQueryResult<number> {
  return useQuery({
    queryKey: queryKeys.esplora.blockHeight,
    queryFn: ({ signal }) => getLatestBlockHeight({ signal }),
    staleTime: STALE_TIME_MS.tip,
    refetchInterval: refetchIntervalMs,
  })
}

export function useBlockHashAtHeight(blockHeight: number): UseQueryResult<string> {
  return useQuery({
    queryKey: queryKeys.esplora.blockHash(blockHeight),
    queryFn: ({ signal }) => getBlockHashAtHeight(blockHeight, { signal }),
    staleTime: STALE_TIME_MS.immutable,
    gcTime: GC_TIME_MS.immutable,
  })
}

export function useBroadcastTx(): UseMutationResult<string, ApiError, string> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (txHex: string) => broadcastTx(txHex),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.esplora.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.offers.all })
    },
  })
}
