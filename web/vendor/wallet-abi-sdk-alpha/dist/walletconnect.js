import { GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD, GET_SIGNER_RECEIVE_ADDRESS_METHOD, WALLET_ABI_JSON_RPC_VERSION, WALLET_ABI_METHODS, WALLET_ABI_PROCESS_REQUEST_METHOD, } from "./protocol.js";
export const WALLET_ABI_WALLETCONNECT_NAMESPACE = "walabi";
export const WALLET_ABI_WALLETCONNECT_CHAINS = [
    "walabi:liquid",
    "walabi:testnet-liquid",
    "walabi:localtest-liquid",
];
export const WALLET_ABI_WALLETCONNECT_EVENTS = [];
export const WALLET_ABI_WALLETCONNECT_METHODS = WALLET_ABI_METHODS;
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
    if (request.method === WALLET_ABI_PROCESS_REQUEST_METHOD) {
        return request.params;
    }
    if (request.params === undefined ||
        Object.keys(request.params).length === 0) {
        // WalletConnect/Reown expects a concrete JSON object for custom RPC getter calls.
        return {};
    }
    return request.params;
}
export function isWalletAbiWalletConnectChain(value) {
    return WALLET_ABI_WALLETCONNECT_CHAINS.includes(value);
}
export function walletAbiNetworkToWalletConnectChain(network) {
    switch (network) {
        case "liquid":
            return "walabi:liquid";
        case "testnet-liquid":
            return "walabi:testnet-liquid";
        case "localtest-liquid":
            return "walabi:localtest-liquid";
    }
}
export function walletConnectChainToWalletAbiNetwork(chainId) {
    switch (chainId) {
        case "walabi:liquid":
            return "liquid";
        case "walabi:testnet-liquid":
            return "testnet-liquid";
        case "walabi:localtest-liquid":
            return "localtest-liquid";
    }
}
export function createWalletAbiRequiredNamespaces(input) {
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
        [WALLET_ABI_WALLETCONNECT_NAMESPACE]: {
            methods: WALLET_ABI_WALLETCONNECT_METHODS,
            chains,
            events: WALLET_ABI_WALLETCONNECT_EVENTS,
        },
    };
}
export function buildWalletAbiCaip10Account(chainId, accountId) {
    return `${chainId}:${accountId}`;
}
export function createWalletConnectRequester(options) {
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
export function isWalletAbiMethod(value) {
    return WALLET_ABI_WALLETCONNECT_METHODS.includes(value);
}
export function isWalletAbiGetterMethod(value) {
    return (value === GET_SIGNER_RECEIVE_ADDRESS_METHOD ||
        value === GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD);
}
export function isWalletAbiProcessMethod(value) {
    return value === WALLET_ABI_PROCESS_REQUEST_METHOD;
}
export function createWalletAbiJsonRpcEnvelopeFromResult(request, result) {
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
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        result: normalizedResult,
    };
}
//# sourceMappingURL=walletconnect.js.map