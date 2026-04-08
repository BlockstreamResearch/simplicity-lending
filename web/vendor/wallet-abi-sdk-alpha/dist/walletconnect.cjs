"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLET_ABI_WALLETCONNECT_METHODS = exports.WALLET_ABI_WALLETCONNECT_EVENTS = exports.WALLET_ABI_WALLETCONNECT_CHAINS = exports.WALLET_ABI_WALLETCONNECT_NAMESPACE = void 0;
exports.isWalletAbiWalletConnectChain = isWalletAbiWalletConnectChain;
exports.walletAbiNetworkToWalletConnectChain = walletAbiNetworkToWalletConnectChain;
exports.walletConnectChainToWalletAbiNetwork = walletConnectChainToWalletAbiNetwork;
exports.createWalletAbiRequiredNamespaces = createWalletAbiRequiredNamespaces;
exports.buildWalletAbiCaip10Account = buildWalletAbiCaip10Account;
exports.createWalletConnectRequester = createWalletConnectRequester;
exports.isWalletAbiMethod = isWalletAbiMethod;
exports.isWalletAbiGetterMethod = isWalletAbiGetterMethod;
exports.isWalletAbiProcessMethod = isWalletAbiProcessMethod;
exports.createWalletAbiJsonRpcEnvelopeFromResult = createWalletAbiJsonRpcEnvelopeFromResult;
const protocol_js_1 = require("./protocol.cjs");
exports.WALLET_ABI_WALLETCONNECT_NAMESPACE = "walabi";
exports.WALLET_ABI_WALLETCONNECT_CHAINS = [
    "walabi:liquid",
    "walabi:testnet-liquid",
    "walabi:localtest-liquid",
];
exports.WALLET_ABI_WALLETCONNECT_EVENTS = [];
exports.WALLET_ABI_WALLETCONNECT_METHODS = protocol_js_1.WALLET_ABI_METHODS;
function resolveTopic(options) {
    const dynamicTopic = options.getTopic?.();
    if (dynamicTopic === null) {
        return undefined;
    }
    if (dynamicTopic !== undefined) {
        return dynamicTopic.trim() || undefined;
    }
    return options.topic?.trim() || undefined;
}
function extractRequestParams(request) {
    if (request.method === protocol_js_1.WALLET_ABI_PROCESS_REQUEST_METHOD) {
        return request.params;
    }
    if (request.params === undefined ||
        Object.keys(request.params).length === 0) {
        // WalletConnect/Reown expects a concrete JSON object for custom RPC getter calls.
        return {};
    }
    return request.params;
}
function isWalletAbiWalletConnectChain(value) {
    return exports.WALLET_ABI_WALLETCONNECT_CHAINS.includes(value);
}
function walletAbiNetworkToWalletConnectChain(network) {
    switch (network) {
        case "liquid":
            return "walabi:liquid";
        case "testnet-liquid":
            return "walabi:testnet-liquid";
        case "localtest-liquid":
            return "walabi:localtest-liquid";
    }
}
function walletConnectChainToWalletAbiNetwork(chainId) {
    switch (chainId) {
        case "walabi:liquid":
            return "liquid";
        case "walabi:testnet-liquid":
            return "testnet-liquid";
        case "walabi:localtest-liquid":
            return "localtest-liquid";
    }
}
function createWalletAbiRequiredNamespaces(input) {
    let chains;
    if (Array.isArray(input)) {
        chains = input;
    }
    else {
        const singleInput = input;
        if (isWalletAbiWalletConnectChain(singleInput)) {
            chains = [singleInput];
        }
        else {
            chains = [walletAbiNetworkToWalletConnectChain(singleInput)];
        }
    }
    return {
        [exports.WALLET_ABI_WALLETCONNECT_NAMESPACE]: {
            methods: exports.WALLET_ABI_WALLETCONNECT_METHODS,
            chains,
            events: exports.WALLET_ABI_WALLETCONNECT_EVENTS,
        },
    };
}
function buildWalletAbiCaip10Account(chainId, accountId) {
    return `${chainId}:${accountId}`;
}
function createWalletConnectRequester(options) {
    return {
        connect() {
            return options.client.connect?.();
        },
        disconnect() {
            return options.client.disconnect?.();
        },
        async request(request) {
            const topic = resolveTopic(options);
            const params = extractRequestParams(request);
            const result = await options.client.request({
                chainId: options.chainId,
                ...(topic === undefined ? {} : { topic }),
                request: {
                    method: request.method,
                    ...(params === undefined ? {} : { params }),
                },
            });
            return createWalletAbiJsonRpcEnvelopeFromResult(request, result);
        },
    };
}
function isWalletAbiMethod(value) {
    return exports.WALLET_ABI_WALLETCONNECT_METHODS.includes(value);
}
function isWalletAbiGetterMethod(value) {
    return (value === protocol_js_1.GET_SIGNER_RECEIVE_ADDRESS_METHOD ||
        value === protocol_js_1.GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD);
}
function isWalletAbiProcessMethod(value) {
    return value === protocol_js_1.WALLET_ABI_PROCESS_REQUEST_METHOD;
}
function createWalletAbiJsonRpcEnvelopeFromResult(request, result) {
    let normalizedResult = result;
    if (typeof normalizedResult === "string") {
        try {
            normalizedResult = JSON.parse(normalizedResult);
        }
        catch {
            // Keep non-JSON strings as-is so caller-side validation can decide.
        }
    }
    return {
        id: request.id,
        jsonrpc: protocol_js_1.WALLET_ABI_JSON_RPC_VERSION,
        result: normalizedResult,
    };
}
//# sourceMappingURL=walletconnect.js.map