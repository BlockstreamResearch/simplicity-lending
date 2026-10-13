import type { NetworkName } from '@/constants/env'

// Humid injects a CAIP-25/CAIP-27 provider as `window.humid`: a dapp opens a session with
// wallet_createSession, then calls every wallet method through wallet_invokeMethod.
// Method shapes follow the Liquid Wallet RPC profile (ELIP PR #36).
export interface HumidProvider {
  request<T>(args: { method: string; params?: unknown }): Promise<T>
}

declare global {
  interface Window {
    humid?: HumidProvider
  }
}

type Caip25Scopes = Record<
  string,
  { accounts?: string[]; methods: string[]; notifications: string[] }
>

export interface HumidSession {
  sessionScopes: Caip25Scopes
}

export interface HumidWalletDescriptorResult {
  accountIdentifier: string
  descriptors: Array<{ descriptor?: string; format: string }>
}

export interface HumidUtxo {
  /** Confidential when the coin is: carries the wallet's blinding pubkey for that script. */
  address: string
  /** Base units, as a decimal string. */
  amount: string
  /** CAIP-19-style id: `bip122:<chain>/elip144:<asset hex>`. */
  assetId: string
  confidential: boolean
  scriptPubKey: string
  /** False while unconfirmed. */
  spendable: boolean
  txid: string
  txOut: string
  vout: number
}

export interface HumidGetUtxosResult {
  utxos: HumidUtxo[]
}

export interface HumidSignPsetParams {
  pset: string
  signInputs: Array<{ index: number; address: string; sighashTypes?: number[] }>
  broadcast?: boolean
}

export interface HumidSignPsetResult {
  pset: string
  txid?: string
}

const PROVIDER_WAIT_MS = 3_000

const CHAIN_IDS: Partial<Record<NetworkName, string>> = {
  liquid: 'bip122:1466275836220db2944ca059a3a10ef6',
  liquidtestnet: 'bip122:a771da8e52ee6ad581ed1e9a99825e5b',
}

export const HUMID_METHODS = ['getWalletDescriptor', 'getUTXOs', 'getBalance', 'signPset']

export function humidChainId(network: NetworkName): string {
  const chainId = CHAIN_IDS[network]
  if (!chainId) throw new Error(`Humid does not support the ${network} network`)
  return chainId
}

/** The extension injects its provider at document_start, but a fresh tab can still race it. */
export async function waitForHumid(): Promise<HumidProvider> {
  const deadline = Date.now() + PROVIDER_WAIT_MS
  while (!window.humid) {
    if (Date.now() >= deadline) {
      throw new Error('Humid extension not found. Install it and reload the page')
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return window.humid
}

export function createSession(provider: HumidProvider, chainId: string): Promise<HumidSession> {
  return provider.request<HumidSession>({
    method: 'wallet_createSession',
    params: { optionalScopes: { [chainId]: { methods: HUMID_METHODS, notifications: [] } } },
  })
}

export function switchChain(provider: HumidProvider, chainId: string): Promise<unknown> {
  return provider.request({ method: 'wallet_switchChain', params: { chainId } })
}

export function revokeSession(provider: HumidProvider): Promise<unknown> {
  return provider.request({ method: 'wallet_revokeSession' })
}

export function invokeMethod<T>(
  provider: HumidProvider,
  chainId: string,
  method: string,
  params?: unknown,
): Promise<T> {
  return provider.request<T>({
    method: 'wallet_invokeMethod',
    params: { scope: chainId, request: { method, params } },
  })
}
