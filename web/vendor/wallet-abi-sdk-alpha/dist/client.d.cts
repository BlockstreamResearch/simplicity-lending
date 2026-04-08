import type { TxCreateRequest, TxCreateResponse, WalletAbiAddress, WalletAbiXOnlyPublicKeyHex } from "./schema.cjs";
import type { WalletAbiRequester } from "./walletconnect.cjs";
interface WalletAbiClientEventMap {
    connected: undefined;
    disconnected: undefined;
}
export interface WalletAbiClientOptions {
    requester: WalletAbiRequester;
    requestTimeoutMs?: number;
}
export declare class WalletAbiClientError extends Error {
    constructor(message: string);
}
export declare class WalletAbiClient {
    #private;
    constructor(options: WalletAbiClientOptions);
    on<K extends keyof WalletAbiClientEventMap>(event: K, listener: (payload: WalletAbiClientEventMap[K]) => void): () => void;
    isConnected(): boolean;
    getCachedSignerReceiveAddress(): WalletAbiAddress | null;
    getCachedRawSigningXOnlyPubkey(): WalletAbiXOnlyPublicKeyHex | null;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getSignerReceiveAddress(): Promise<WalletAbiAddress>;
    getRawSigningXOnlyPubkey(): Promise<WalletAbiXOnlyPublicKeyHex>;
    processRequest(request: TxCreateRequest): Promise<TxCreateResponse>;
    requestTxCreate(request: TxCreateRequest): Promise<TxCreateResponse>;
}
export {};
