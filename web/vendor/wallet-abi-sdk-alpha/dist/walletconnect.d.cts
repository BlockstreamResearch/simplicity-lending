import { GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD, GET_SIGNER_RECEIVE_ADDRESS_METHOD, WALLET_ABI_PROCESS_REQUEST_METHOD, type WalletAbiJsonRpcRequest, type WalletAbiJsonRpcResponse, type WalletAbiMethod } from "./protocol.cjs";
import type { WalletAbiNetwork } from "./schema.cjs";
type MaybePromise<T> = Promise<T> | T;
export interface WalletAbiRequester {
    connect?(): MaybePromise<void>;
    disconnect?(): MaybePromise<void>;
    request(request: WalletAbiJsonRpcRequest): MaybePromise<WalletAbiJsonRpcResponse>;
}
export declare const WALLET_ABI_WALLETCONNECT_NAMESPACE: "walabi";
export declare const WALLET_ABI_WALLETCONNECT_CHAINS: readonly ["walabi:liquid", "walabi:testnet-liquid", "walabi:localtest-liquid"];
export declare const WALLET_ABI_WALLETCONNECT_EVENTS: readonly [];
export declare const WALLET_ABI_WALLETCONNECT_METHODS: readonly ["get_signer_receive_address", "get_raw_signing_x_only_pubkey", "wallet_abi_process_request"];
export type WalletAbiWalletConnectChain = (typeof WALLET_ABI_WALLETCONNECT_CHAINS)[number];
export interface WalletAbiWalletConnectNamespace {
    methods: readonly WalletAbiMethod[];
    chains: readonly WalletAbiWalletConnectChain[];
    events: readonly string[];
    accounts?: readonly string[];
}
export interface WalletAbiWalletConnectSessionRequest {
    chainId: WalletAbiWalletConnectChain;
    request: {
        method: WalletAbiMethod;
        params?: unknown;
    };
    topic?: string;
}
export interface WalletAbiWalletConnectClient {
    connect?(): MaybePromise<void>;
    disconnect?(): MaybePromise<void>;
    request(input: WalletAbiWalletConnectSessionRequest): MaybePromise<unknown>;
}
export interface CreateWalletConnectRequesterOptions {
    chainId: WalletAbiWalletConnectChain;
    client: WalletAbiWalletConnectClient;
    topic?: string;
    getTopic?(): string | null | undefined;
}
export declare function isWalletAbiWalletConnectChain(value: string): value is WalletAbiWalletConnectChain;
export declare function walletAbiNetworkToWalletConnectChain(network: WalletAbiNetwork): WalletAbiWalletConnectChain;
export declare function walletConnectChainToWalletAbiNetwork(chainId: WalletAbiWalletConnectChain): WalletAbiNetwork;
export declare function createWalletAbiRequiredNamespaces(input: WalletAbiNetwork | WalletAbiWalletConnectChain | readonly WalletAbiWalletConnectChain[]): Record<typeof WALLET_ABI_WALLETCONNECT_NAMESPACE, WalletAbiWalletConnectNamespace>;
export declare function buildWalletAbiCaip10Account(chainId: WalletAbiWalletConnectChain, accountId: string): string;
export declare function createWalletConnectRequester(options: CreateWalletConnectRequesterOptions): WalletAbiRequester;
export declare function isWalletAbiMethod(value: string): value is WalletAbiMethod;
export declare function isWalletAbiGetterMethod(value: string): value is typeof GET_SIGNER_RECEIVE_ADDRESS_METHOD | typeof GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD;
export declare function isWalletAbiProcessMethod(value: string): value is typeof WALLET_ABI_PROCESS_REQUEST_METHOD;
export declare function createWalletAbiJsonRpcEnvelopeFromResult(request: WalletAbiJsonRpcRequest, result: unknown): WalletAbiJsonRpcResponse;
export {};
