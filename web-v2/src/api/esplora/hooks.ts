import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'

import type { ApiError } from '../errors'
import { GC_TIME_MS, STALE_TIME_MS } from '../staleTime'
import {
  broadcastTx,
  fetchAddressInfo,
  fetchAddressTxs,
  fetchAddressUtxo,
  fetchBlockHashAtHeight,
  fetchLatestBlockHeight,
  fetchTx,
  fetchTxOutspends,
} from './methods'
import { esploraQueryKeys } from './queryKeys'
import type {
  AddressInfo,
  EsploraOutspend,
  EsploraTx,
  ScriptHashTxEntry,
  ScriptHashUtxoEntry,
} from './schemas'

const DEFAULT_BLOCK_HEIGHT_POLL_MS = 30_000

export function useTx(txId: string): UseQueryResult<EsploraTx> {
  return useQuery({
    queryKey: esploraQueryKeys.tx(txId),
    queryFn: ({ signal }) => fetchTx(txId, { signal }),
    staleTime: STALE_TIME_MS.long,
    gcTime: GC_TIME_MS.long,
    enabled: !!txId,
  })
}

export function useTxOutspends(txId: string): UseQueryResult<EsploraOutspend[]> {
  return useQuery({
    queryKey: esploraQueryKeys.txOutspends(txId),
    queryFn: ({ signal }) => fetchTxOutspends(txId, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: !!txId,
  })
}

export function useAddressInfo(address: string): UseQueryResult<AddressInfo> {
  return useQuery({
    queryKey: esploraQueryKeys.addressInfo(address),
    queryFn: ({ signal }) => fetchAddressInfo(address, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: !!address,
  })
}

export function useAddressUtxos(address: string): UseQueryResult<ScriptHashUtxoEntry[]> {
  return useQuery({
    queryKey: esploraQueryKeys.addressUtxo(address),
    queryFn: ({ signal }) => fetchAddressUtxo(address, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!address,
  })
}

export function useAddressTxs(
  address: string,
  lastSeenTxId?: string,
): UseQueryResult<ScriptHashTxEntry[]> {
  return useQuery({
    queryKey: esploraQueryKeys.addressTxs(address, lastSeenTxId),
    queryFn: ({ signal }) => fetchAddressTxs(address, lastSeenTxId, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: !!address,
  })
}

export function useBlockHeight(
  refetchIntervalMs: number = DEFAULT_BLOCK_HEIGHT_POLL_MS,
): UseQueryResult<number> {
  return useQuery({
    queryKey: esploraQueryKeys.blockHeight,
    queryFn: ({ signal }) => fetchLatestBlockHeight({ signal }),
    staleTime: STALE_TIME_MS.tip,
    refetchInterval: refetchIntervalMs,
  })
}

export function useBlockHashAtHeight(blockHeight: number): UseQueryResult<string> {
  return useQuery({
    queryKey: esploraQueryKeys.blockHash(blockHeight),
    queryFn: ({ signal }) => fetchBlockHashAtHeight(blockHeight, { signal }),
    staleTime: STALE_TIME_MS.immutable,
    gcTime: GC_TIME_MS.immutable,
  })
}

export interface BroadcastTxVariables {
  txHex: string
  signal?: AbortSignal
}

export type UseBroadcastTxOptions = Omit<
  UseMutationOptions<string, ApiError, BroadcastTxVariables>,
  'mutationFn'
>

export function useBroadcastTx(
  options: UseBroadcastTxOptions = {},
): UseMutationResult<string, ApiError, BroadcastTxVariables> {
  return useMutation({
    ...options,
    mutationFn: ({ txHex, signal }: BroadcastTxVariables) => broadcastTx(txHex, { signal }),
  })
}
