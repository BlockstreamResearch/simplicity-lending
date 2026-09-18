import type {
	Caip25CreateSessionResult,
	Caip25GetSessionResult,
	Caip25Scopes,
	CaipRpcProvider,
} from "./types";

export const CAIP25_METHODS = {
	addChain: "wallet_addChain",
	createSession: "wallet_createSession",
	getSession: "wallet_getSession",
	invokeMethod: "wallet_invokeMethod",
	revokeSession: "wallet_revokeSession",
	switchChain: "wallet_switchChain",
} as const;

export type AddChainParams = {
	name: string;
	settings: {
		backend: { url: string };
		explorerUrl?: string;
		network: string;
		policyAsset?: string;
	};
};

export function createSession(
	provider: CaipRpcProvider,
	optionalScopes: Caip25Scopes,
): Promise<Caip25CreateSessionResult> {
	return provider.request<Caip25CreateSessionResult>({
		method: CAIP25_METHODS.createSession,
		params: { optionalScopes },
	});
}

export function getSession(provider: CaipRpcProvider): Promise<Caip25GetSessionResult> {
	return provider.request<Caip25GetSessionResult>({
		method: CAIP25_METHODS.getSession,
	});
}

export function revokeSession(provider: CaipRpcProvider): Promise<{ revoked: boolean }> {
	return provider.request<{ revoked: boolean }>({
		method: CAIP25_METHODS.revokeSession,
	});
}

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

export function addChain(
	provider: CaipRpcProvider,
	params: AddChainParams,
): Promise<{ chainId: string }> {
	return provider.request<{ chainId: string }>({
		method: CAIP25_METHODS.addChain,
		params,
	});
}

export function switchChain(
	provider: CaipRpcProvider,
	chainId: string,
): Promise<{ chainId: string }> {
	return provider.request<{ chainId: string }>({
		method: CAIP25_METHODS.switchChain,
		params: { chainId },
	});
}
