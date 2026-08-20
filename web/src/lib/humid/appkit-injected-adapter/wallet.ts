import type {
	LiquidGetBalanceParams,
	LiquidGetBalanceResult,
	LiquidGetIdentityPublicKeyParams,
	LiquidGetIdentityPublicKeyResult,
	LiquidGetIdentitySharedKeyParams,
	LiquidGetIdentitySharedKeyResult,
	LiquidGetUTXOsParams,
	LiquidGetUTXOsResult,
	LiquidGetWalletDescriptorParams,
	LiquidGetWalletDescriptorResult,
	LiquidProcessConfidentialTransactionParams,
	LiquidSendTransferParams,
	LiquidSendTransferResult,
	LiquidSignIdentityParams,
	LiquidSignIdentityResult,
	LiquidSignMessageParams,
	LiquidSignMessageResult,
	LiquidSignPsetParams,
	LiquidSignPsetResult,
} from "./liquid-rpc";
import { invokeMethod } from "./rpc";
import type { CaipRpcProvider } from "./types";

/**
 * A typed facade over the ten Liquid Wallet RPC methods. Each call is a CAIP-27 `wallet_invokeMethod`
 * with the params/result shapes from `./liquid-rpc`, so a dapp works against real types instead of
 * hand-rolled envelopes.
 */
export type WalletClient = {
	getBalance(params?: LiquidGetBalanceParams): Promise<LiquidGetBalanceResult>;
	getUTXOs(params?: LiquidGetUTXOsParams): Promise<LiquidGetUTXOsResult>;
	getWalletDescriptor(
		params: LiquidGetWalletDescriptorParams,
	): Promise<LiquidGetWalletDescriptorResult>;
	sendTransfer(params: LiquidSendTransferParams): Promise<LiquidSendTransferResult>;
	signMessage(params: LiquidSignMessageParams): Promise<LiquidSignMessageResult>;
	signPset(params: LiquidSignPsetParams): Promise<LiquidSignPsetResult>;
	getIdentityPublicKey(
		params: LiquidGetIdentityPublicKeyParams,
	): Promise<LiquidGetIdentityPublicKeyResult>;
	getIdentitySharedKey(
		params: LiquidGetIdentitySharedKeyParams,
	): Promise<LiquidGetIdentitySharedKeyResult>;
	signIdentity(params: LiquidSignIdentityParams): Promise<LiquidSignIdentityResult>;
	processConfidentialTransaction(
		params: LiquidProcessConfidentialTransactionParams,
	): Promise<unknown>;
};

/**
 * Build a {@link WalletClient} bound to a provider and a fixed CAIP-2 `scope` (the active chain).
 * Every method routes through `invokeMethod`, so the method-name strings stay in lock-step with the
 * wallet's `liquidWalletRpcMethods` surface.
 */
export function createWalletClient(provider: CaipRpcProvider, scope: string): WalletClient {
	return {
		getBalance: (params) =>
			invokeMethod<LiquidGetBalanceResult>(provider, scope, "getBalance", params),
		getUTXOs: (params) => invokeMethod<LiquidGetUTXOsResult>(provider, scope, "getUTXOs", params),
		getWalletDescriptor: (params) =>
			invokeMethod<LiquidGetWalletDescriptorResult>(provider, scope, "getWalletDescriptor", params),
		sendTransfer: (params) =>
			invokeMethod<LiquidSendTransferResult>(provider, scope, "sendTransfer", params),
		signMessage: (params) =>
			invokeMethod<LiquidSignMessageResult>(provider, scope, "signMessage", params),
		signPset: (params) => invokeMethod<LiquidSignPsetResult>(provider, scope, "signPset", params),
		getIdentityPublicKey: (params) =>
			invokeMethod<LiquidGetIdentityPublicKeyResult>(
				provider,
				scope,
				"getIdentityPublicKey",
				params,
			),
		getIdentitySharedKey: (params) =>
			invokeMethod<LiquidGetIdentitySharedKeyResult>(
				provider,
				scope,
				"getIdentitySharedKey",
				params,
			),
		signIdentity: (params) =>
			invokeMethod<LiquidSignIdentityResult>(provider, scope, "signIdentity", params),
		processConfidentialTransaction: (params) =>
			invokeMethod<unknown>(provider, scope, "processConfidentialTransaction", params),
	};
}
