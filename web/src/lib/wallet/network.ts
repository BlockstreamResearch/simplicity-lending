import type { CaipNetwork } from '@reown/appkit-common'

import { env, type NetworkName } from '@/constants/env'
import { liquid, liquidTestnet } from '@/lib/humid/appkit-injected-adapter'

/**
 * The chain each configured network maps to, or `null` where the wallet has no chain for it.
 *
 * `VITE_NETWORK` is the single source for both sides of this dapp: the wallet connection reads
 * it here and the in-page chain library reads it in `createLwkNetwork`, so the two agree by
 * construction rather than by two lists someone has to keep in step.
 */
const WALLET_CHAIN_BY_NETWORK: Record<NetworkName, CaipNetwork | null> = {
  liquid,
  liquidtestnet: liquidTestnet,
  // The wallet publishes mainnet and testnet only. A local Elements chain would have to be
  // proposed to the wallet with `wallet_addChain`, which nothing here does.
  regtest: null,
}

/** The one chain this dapp's wallet connection speaks for, or null when the wallet has none. */
export const WALLET_CHAIN: CaipNetwork | null = WALLET_CHAIN_BY_NETWORK[env.VITE_NETWORK]

/** Why the wallet cannot serve the configured network, or null when it can. */
export const WALLET_CHAIN_UNSUPPORTED_REASON: string | null = WALLET_CHAIN
  ? null
  : `The wallet has no Liquid chain for ${env.VITE_NETWORK}.`

/**
 * The chains registered with the connection layer: exactly one, always.
 *
 * One is not a simplification, it is the safety property. A caller that names no chain is
 * answered with the first registered one, so a list holding mainnet is a mainnet approval
 * waiting for a missing argument. Registering only the configured chain makes that fallback
 * land on the chain this build is for. A build the wallet cannot serve still registers a chain
 * — the connection layer requires one to exist at all — and {@link WALLET_CHAIN} being null is
 * what refuses the connection.
 */
export const WALLET_CHAINS: [CaipNetwork] = [WALLET_CHAIN ?? liquidTestnet]

/** CAIP-2 id every wallet call is scoped to. Null when the wallet cannot serve this build. */
export const WALLET_CHAIN_ID: string | null = WALLET_CHAIN?.caipNetworkId ?? null

/** The CAIP-2 namespace Liquid shares with Bitcoin. Accounts and views are keyed by it. */
export const WALLET_NAMESPACE = liquidTestnet.chainNamespace

/**
 * The chain a wallet that signs in this page is scoped to.
 *
 * The connection layer publishes ids for the chains the extension serves, and has none for a
 * local Elements chain. A wallet holding a key of its own is on whatever chain the chain library
 * was built for, including that one, so it is named here rather than left without an account.
 */
export const SIGNING_CHAIN_ID: string = WALLET_CHAIN_ID ?? `bip122:${env.VITE_NETWORK}`
