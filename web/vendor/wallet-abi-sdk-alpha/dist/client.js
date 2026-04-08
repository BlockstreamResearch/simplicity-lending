import { GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD, GET_SIGNER_RECEIVE_ADDRESS_METHOD, WALLET_ABI_PROCESS_REQUEST_METHOD, createGetRawSigningXOnlyPubkeyRequest, createGetSignerReceiveAddressRequest, createProcessRequest, isJsonRpcErrorResponse, isWalletAbiGetRawSigningXOnlyPubkeyResponse, isWalletAbiGetSignerReceiveAddressResponse, isWalletAbiProcessResponse, } from "./protocol.js";
export class WalletAbiClientError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletAbiClientError";
    }
}
function normalizeErrorMessage(error) {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return String(error);
}
export class WalletAbiClient {
    #requester;
    #requestTimeoutMs;
    #listeners = new Map();
    #connectPromise = null;
    #rpcRequestId = 0;
    #connected = false;
    #signerReceiveAddress = null;
    #rawSigningXOnlyPubkey = null;
    constructor(options) {
        this.#requester = options.requester;
        this.#requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    }
    on(event, listener) {
        const listeners = this.#listeners.get(event) ?? new Set();
        listeners.add(listener);
        this.#listeners.set(event, listeners);
        return () => {
            listeners.delete(listener);
        };
    }
    isConnected() {
        return this.#connected;
    }
    getCachedSignerReceiveAddress() {
        return this.#signerReceiveAddress;
    }
    getCachedRawSigningXOnlyPubkey() {
        return this.#rawSigningXOnlyPubkey;
    }
    async connect() {
        if (this.#connected) {
            return;
        }
        if (this.#connectPromise !== null) {
            await this.#connectPromise;
            return;
        }
        this.#connectPromise = (async () => {
            await this.#requester.connect?.();
            this.#connected = true;
            this.#emit("connected", undefined);
        })();
        try {
            await this.#connectPromise;
        }
        finally {
            this.#connectPromise = null;
        }
    }
    async disconnect() {
        this.#connected = false;
        this.#signerReceiveAddress = null;
        this.#rawSigningXOnlyPubkey = null;
        await this.#requester.disconnect?.();
        this.#emit("disconnected", undefined);
    }
    async getSignerReceiveAddress() {
        if (this.#signerReceiveAddress !== null) {
            return this.#signerReceiveAddress;
        }
        const response = await this.#sendJsonRpc(createGetSignerReceiveAddressRequest(this.#nextRpcRequestId()));
        if (isJsonRpcErrorResponse(response)) {
            throw new WalletAbiClientError(`${GET_SIGNER_RECEIVE_ADDRESS_METHOD} failed: ${response.error.message}`);
        }
        if (!isWalletAbiGetSignerReceiveAddressResponse(response)) {
            throw new WalletAbiClientError(`expected ${GET_SIGNER_RECEIVE_ADDRESS_METHOD} result`);
        }
        this.#signerReceiveAddress = response.result.signer_receive_address;
        return this.#signerReceiveAddress;
    }
    async getRawSigningXOnlyPubkey() {
        if (this.#rawSigningXOnlyPubkey !== null) {
            return this.#rawSigningXOnlyPubkey;
        }
        const response = await this.#sendJsonRpc(createGetRawSigningXOnlyPubkeyRequest(this.#nextRpcRequestId()));
        if (isJsonRpcErrorResponse(response)) {
            throw new WalletAbiClientError(`${GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD} failed: ${response.error.message}`);
        }
        if (!isWalletAbiGetRawSigningXOnlyPubkeyResponse(response)) {
            throw new WalletAbiClientError(`expected ${GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD} result`);
        }
        this.#rawSigningXOnlyPubkey = response.result.raw_signing_x_only_pubkey;
        return this.#rawSigningXOnlyPubkey;
    }
    async processRequest(request) {
        const response = await this.#sendJsonRpc(createProcessRequest(this.#nextRpcRequestId(), request));
        if (isJsonRpcErrorResponse(response)) {
            throw new WalletAbiClientError(`wallet JSON-RPC error ${String(response.error.code)}: ${response.error.message}`);
        }
        if (!isWalletAbiProcessResponse(response)) {
            throw new WalletAbiClientError(`expected ${WALLET_ABI_PROCESS_REQUEST_METHOD} result`);
        }
        return response.result;
    }
    async requestTxCreate(request) {
        return this.processRequest(request);
    }
    #nextRpcRequestId() {
        this.#rpcRequestId += 1;
        return this.#rpcRequestId;
    }
    #emit(event, payload) {
        const listeners = this.#listeners.get(event);
        if (listeners === undefined) {
            return;
        }
        for (const listener of listeners) {
            listener(payload);
        }
    }
    async #sendJsonRpc(request) {
        await this.connect();
        try {
            return await this.#withTimeout(Promise.resolve(this.#requester.request(request)), `wallet request ${request.method} timed out after ${String(this.#requestTimeoutMs)}ms`);
        }
        catch (error) {
            if (error instanceof WalletAbiClientError) {
                throw error;
            }
            throw new WalletAbiClientError(normalizeErrorMessage(error));
        }
    }
    async #withTimeout(promise, message) {
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new WalletAbiClientError(message));
            }, this.#requestTimeoutMs);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        }
        finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }
}
//# sourceMappingURL=client.js.map