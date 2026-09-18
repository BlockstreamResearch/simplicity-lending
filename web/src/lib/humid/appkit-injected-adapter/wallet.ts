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
	LiquidProcessConfidentialTransactionResult,
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
	): Promise<LiquidProcessConfidentialTransactionResult>;
};

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
			invokeMethod<LiquidProcessConfidentialTransactionResult>(
				provider,
				scope,
				"processConfidentialTransaction",
				params,
			),
	};
}
