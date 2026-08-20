import type {
	Caip25CreateSessionResult,
	Caip25GetSessionResult,
	Caip25Scopes,
	CaipRpcProvider,
} from "./types";

/**
 * CAIP-25 (session authorization) + CAIP-27 (method invocation) envelope an injected wallet expects.
 * The wallet does NOT expose raw chain RPC methods directly: a dapp authorizes with
 * `wallet_createSession`, then invokes every method through `wallet_invokeMethod`, scoped to a chain.
 * These helpers are the one place that wraps raw calls into that envelope.
 */
export const CAIP25_METHODS = {
	addChain: "wallet_addChain",
	createSession: "wallet_createSession",
	getSession: "wallet_getSession",
	invokeMethod: "wallet_invokeMethod",
	revokeSession: "wallet_revokeSession",
	switchChain: "wallet_switchChain",
} as const;

/**
 * Parameters for {@link addChain}. `chainId` is intentionally absent: the wallet mints its OWN id
 * (never trusting a dapp-supplied one) and returns it. `settings` mirrors the wallet's chain model.
 */
export type AddChainParams = {
	name: string;
	settings: {
		backend: { url: string };
		explorerUrl?: string;
		network: string;
		policyAsset?: string;
	};
};

/** Authorize a CAIP-25 session; typically opens the wallet's connect approval modal. */
export function createSession(
	provider: CaipRpcProvider,
	optionalScopes: Caip25Scopes,
): Promise<Caip25CreateSessionResult> {
	return provider.request<Caip25CreateSessionResult>({
		method: CAIP25_METHODS.createSession,
		params: { optionalScopes },
	});
}

/**
 * Read the current session's authorized scopes and per-scope properties (empty scopes when there is
 * none). `sessionScopes[chainId].methods` is the full callable surface; `scopedProperties` carries
 * the wallet's method policy (see `readMethodPolicy`).
 */
export function getSession(provider: CaipRpcProvider): Promise<Caip25GetSessionResult> {
	return provider.request<Caip25GetSessionResult>({
		method: CAIP25_METHODS.getSession,
	});
}

/** Revoke the current session for this origin. */
export function revokeSession(provider: CaipRpcProvider): Promise<{ revoked: boolean }> {
	return provider.request<{ revoked: boolean }>({
		method: CAIP25_METHODS.revokeSession,
	});
}

/** Invoke one method (CAIP-27) within a chain scope of the authorized session. */
export function invokeMethod<T>(
	provider: CaipRpcProvider,
	scope: string,
	method: string,
	params?: unknown,
): Promise<T> {
	return provider.request<T>({
		method: CAIP25_METHODS.invokeMethod,
		params: { scope, request: { method, params } },
	});
}

/**
 * Propose a new chain to the wallet (EIP-3085-style). The wallet gates this behind a user approval
 * and mints its OWN chain id (ignoring any dapp-supplied id), returning it — pass that id to
 * {@link switchChain} to have this connection granted the new chain.
 */
export function addChain(
	provider: CaipRpcProvider,
	params: AddChainParams,
): Promise<{ chainId: string }> {
	return provider.request<{ chainId: string }>({
		method: CAIP25_METHODS.addChain,
		params,
	});
}

/**
 * Ask the wallet to grant THIS connection a chain it already knows (a per-connection scope
 * expansion, user-approved). Resolves once the chain is authorized; rejects with the wallet's
 * "unrecognized chain" error (EVM code 4902) when the chain is unknown — call {@link addChain} first.
 */
export function switchChain(
	provider: CaipRpcProvider,
	chainId: string,
): Promise<{ chainId: string }> {
	return provider.request<{ chainId: string }>({
		method: CAIP25_METHODS.switchChain,
		params: { chainId },
	});
}
