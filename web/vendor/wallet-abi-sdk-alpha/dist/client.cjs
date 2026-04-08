"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletAbiClient = exports.WalletAbiClientError = void 0;
const protocol_js_1 = require("./protocol.cjs");
class WalletAbiClientError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletAbiClientError";
    }
}
exports.WalletAbiClientError = WalletAbiClientError;
function normalizeErrorMessage(error) {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return String(error);
}
class WalletAbiClient {
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
        const response = await this.#sendJsonRpc((0, protocol_js_1.createGetSignerReceiveAddressRequest)(this.#nextRpcRequestId()));
        if ((0, protocol_js_1.isJsonRpcErrorResponse)(response)) {
            throw new WalletAbiClientError(`${protocol_js_1.GET_SIGNER_RECEIVE_ADDRESS_METHOD} failed: ${response.error.message}`);
        }
        if (!(0, protocol_js_1.isWalletAbiGetSignerReceiveAddressResponse)(response)) {
            throw new WalletAbiClientError(`expected ${protocol_js_1.GET_SIGNER_RECEIVE_ADDRESS_METHOD} result`);
        }
        this.#signerReceiveAddress = response.result.signer_receive_address;
        return this.#signerReceiveAddress;
    }
    async getRawSigningXOnlyPubkey() {
        if (this.#rawSigningXOnlyPubkey !== null) {
            return this.#rawSigningXOnlyPubkey;
        }
        const response = await this.#sendJsonRpc((0, protocol_js_1.createGetRawSigningXOnlyPubkeyRequest)(this.#nextRpcRequestId()));
        if ((0, protocol_js_1.isJsonRpcErrorResponse)(response)) {
            throw new WalletAbiClientError(`${protocol_js_1.GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD} failed: ${response.error.message}`);
        }
        if (!(0, protocol_js_1.isWalletAbiGetRawSigningXOnlyPubkeyResponse)(response)) {
            throw new WalletAbiClientError(`expected ${protocol_js_1.GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD} result`);
        }
        this.#rawSigningXOnlyPubkey = response.result.raw_signing_x_only_pubkey;
        return this.#rawSigningXOnlyPubkey;
    }
    async processRequest(request) {
        const response = await this.#sendJsonRpc((0, protocol_js_1.createProcessRequest)(this.#nextRpcRequestId(), request));
        if ((0, protocol_js_1.isJsonRpcErrorResponse)(response)) {
            throw new WalletAbiClientError(`wallet JSON-RPC error ${String(response.error.code)}: ${response.error.message}`);
        }
        if (!(0, protocol_js_1.isWalletAbiProcessResponse)(response)) {
            throw new WalletAbiClientError(`expected ${protocol_js_1.WALLET_ABI_PROCESS_REQUEST_METHOD} result`);
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
exports.WalletAbiClient = WalletAbiClient;
//# sourceMappingURL=client.js.map