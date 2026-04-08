import { GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD, GET_SIGNER_RECEIVE_ADDRESS_METHOD, WALLET_ABI_JSON_RPC_VERSION, WALLET_ABI_PROCESS_REQUEST_METHOD, } from "./protocol.js";
const JSON_RPC_INVALID_PARAMS = -32602;
function createErrorResponse(request, code, message) {
    return {
        id: request.id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        error: {
            code,
            message,
        },
    };
}
export function createWalletAbiJsonRpcProvider(bridge) {
    return {
        async request(request) {
            switch (request.method) {
                case GET_SIGNER_RECEIVE_ADDRESS_METHOD:
                    if (request.params !== undefined &&
                        Object.keys(request.params).length > 0) {
                        return createErrorResponse(request, JSON_RPC_INVALID_PARAMS, `method "${GET_SIGNER_RECEIVE_ADDRESS_METHOD}" does not accept params`);
                    }
                    return {
                        id: request.id,
                        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                        result: {
                            signer_receive_address: await bridge.getSignerReceiveAddress(),
                        },
                    };
                case GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD:
                    if (request.params !== undefined &&
                        Object.keys(request.params).length > 0) {
                        return createErrorResponse(request, JSON_RPC_INVALID_PARAMS, `method "${GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD}" does not accept params`);
                    }
                    return {
                        id: request.id,
                        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                        result: {
                            raw_signing_x_only_pubkey: await bridge.getRawSigningXOnlyPubkey(),
                        },
                    };
                case WALLET_ABI_PROCESS_REQUEST_METHOD:
                    return {
                        id: request.id,
                        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                        result: await bridge.processRequest(request.params),
                    };
            }
        },
    };
}
//# sourceMappingURL=wallet.js.map