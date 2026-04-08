import { type TxCreateRequest, type TxCreateResponse, type WalletAbiAddress, type WalletAbiXOnlyPublicKeyHex } from "./schema.cjs";
export declare const WALLET_ABI_JSON_RPC_VERSION: "2.0";
export declare const GET_SIGNER_RECEIVE_ADDRESS_METHOD: "get_signer_receive_address";
export declare const GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD: "get_raw_signing_x_only_pubkey";
export declare const WALLET_ABI_PROCESS_REQUEST_METHOD: "wallet_abi_process_request";
export declare const WALLET_ABI_METHODS: readonly ["get_signer_receive_address", "get_raw_signing_x_only_pubkey", "wallet_abi_process_request"];
export type WalletAbiMethod = (typeof WALLET_ABI_METHODS)[number];
export interface WalletAbiJsonRpcErrorObject {
    code: number;
    message: string;
}
export interface WalletAbiGetSignerReceiveAddressRequest {
    id: number;
    jsonrpc: typeof WALLET_ABI_JSON_RPC_VERSION;
    method: typeof GET_SIGNER_RECEIVE_ADDRESS_METHOD;
    params?: Record<string, never>;
}
export interface WalletAbiGetRawSigningXOnlyPubkeyRequest {
    id: number;
    jsonrpc: typeof WALLET_ABI_JSON_RPC_VERSION;
    method: typeof GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD;
    params?: Record<string, never>;
}
export interface WalletAbiProcessRequest {
    id: number;
    jsonrpc: typeof WALLET_ABI_JSON_RPC_VERSION;
    method: typeof WALLET_ABI_PROCESS_REQUEST_METHOD;
    params: TxCreateRequest;
}
export type WalletAbiJsonRpcRequest = WalletAbiGetSignerReceiveAddressRequest | WalletAbiGetRawSigningXOnlyPubkeyRequest | WalletAbiProcessRequest;
export interface WalletAbiJsonRpcSuccessResponse<TResult> {
    id: number;
    jsonrpc: typeof WALLET_ABI_JSON_RPC_VERSION;
    result: TResult;
}
export interface WalletAbiJsonRpcErrorResponse {
    id: number;
    jsonrpc: typeof WALLET_ABI_JSON_RPC_VERSION;
    error: WalletAbiJsonRpcErrorObject;
}
export interface WalletAbiSignerReceiveAddressResult {
    signer_receive_address: WalletAbiAddress;
}
export interface WalletAbiRawSigningXOnlyPubkeyResult {
    raw_signing_x_only_pubkey: WalletAbiXOnlyPublicKeyHex;
}
export type WalletAbiGetSignerReceiveAddressResponse = WalletAbiJsonRpcSuccessResponse<WalletAbiSignerReceiveAddressResult>;
export type WalletAbiGetRawSigningXOnlyPubkeyResponse = WalletAbiJsonRpcSuccessResponse<WalletAbiRawSigningXOnlyPubkeyResult>;
export type WalletAbiProcessResponse = WalletAbiJsonRpcSuccessResponse<TxCreateResponse>;
export type WalletAbiJsonRpcResponse = WalletAbiGetSignerReceiveAddressResponse | WalletAbiGetRawSigningXOnlyPubkeyResponse | WalletAbiProcessResponse | WalletAbiJsonRpcErrorResponse;
export declare class WalletAbiProtocolError extends Error {
    constructor(message: string);
}
export declare function createGetSignerReceiveAddressRequest(id: number): WalletAbiGetSignerReceiveAddressRequest;
export declare function createGetRawSigningXOnlyPubkeyRequest(id: number): WalletAbiGetRawSigningXOnlyPubkeyRequest;
export declare function createProcessRequest(id: number, params: TxCreateRequest): WalletAbiProcessRequest;
export declare function createJsonRpcSuccessResponse<TResult>(request: WalletAbiJsonRpcRequest, result: TResult): WalletAbiJsonRpcSuccessResponse<TResult>;
export declare function isJsonRpcErrorResponse(value: unknown): value is WalletAbiJsonRpcErrorResponse;
export declare function isWalletAbiGetSignerReceiveAddressResponse(value: unknown): value is WalletAbiGetSignerReceiveAddressResponse;
export declare function isWalletAbiGetRawSigningXOnlyPubkeyResponse(value: unknown): value is WalletAbiGetRawSigningXOnlyPubkeyResponse;
export declare function isWalletAbiProcessResponse(value: unknown): value is WalletAbiProcessResponse;
export declare function parseWalletAbiJsonRpcRequest(value: unknown): WalletAbiJsonRpcRequest;
export declare function parseWalletAbiJsonRpcResponse(value: unknown): WalletAbiJsonRpcResponse;
