import { type WalletAbiJsonRpcRequest, type WalletAbiJsonRpcResponse } from "./protocol.cjs";
import type { TxCreateRequest, TxCreateResponse, WalletAbiAddress, WalletAbiXOnlyPublicKeyHex } from "./schema.cjs";
type MaybePromise<T> = Promise<T> | T;
export interface WalletAbiProviderBridge {
    getSignerReceiveAddress(): MaybePromise<WalletAbiAddress>;
    getRawSigningXOnlyPubkey(): MaybePromise<WalletAbiXOnlyPublicKeyHex>;
    processRequest(request: TxCreateRequest): MaybePromise<TxCreateResponse>;
}
export interface WalletAbiJsonRpcProvider {
    request(request: WalletAbiJsonRpcRequest): MaybePromise<WalletAbiJsonRpcResponse>;
}
export declare function createWalletAbiJsonRpcProvider(bridge: WalletAbiProviderBridge): WalletAbiJsonRpcProvider;
export {};
