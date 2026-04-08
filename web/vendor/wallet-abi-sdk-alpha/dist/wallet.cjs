"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWalletAbiJsonRpcProvider = createWalletAbiJsonRpcProvider;
const protocol_js_1 = require("./protocol.cjs");
const JSON_RPC_INVALID_PARAMS = -32602;
function createErrorResponse(request, code, message) {
    return {
        id: request.id,
        jsonrpc: protocol_js_1.WALLET_ABI_JSON_RPC_VERSION,
        error: {
            code,
            message,
        },
    };
}
function createWalletAbiJsonRpcProvider(bridge) {
    return {
        async request(request) {
            switch (request.method) {
                case protocol_js_1.GET_SIGNER_RECEIVE_ADDRESS_METHOD:
                    if (request.params !== undefined &&
                        Object.keys(request.params).length > 0) {
                        return createErrorResponse(request, JSON_RPC_INVALID_PARAMS, `method "${protocol_js_1.GET_SIGNER_RECEIVE_ADDRESS_METHOD}" does not accept params`);
                    }
                    return {
                        id: request.id,
                        jsonrpc: protocol_js_1.WALLET_ABI_JSON_RPC_VERSION,
                        result: {
                            signer_receive_address: await bridge.getSignerReceiveAddress(),
                        },
                    };
                case protocol_js_1.GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD:
                    if (request.params !== undefined &&
                        Object.keys(request.params).length > 0) {
                        return createErrorResponse(request, JSON_RPC_INVALID_PARAMS, `method "${protocol_js_1.GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD}" does not accept params`);
                    }
                    return {
                        id: request.id,
                        jsonrpc: protocol_js_1.WALLET_ABI_JSON_RPC_VERSION,
                        result: {
                            raw_signing_x_only_pubkey: await bridge.getRawSigningXOnlyPubkey(),
                        },
                    };
                case protocol_js_1.WALLET_ABI_PROCESS_REQUEST_METHOD:
                    return {
                        id: request.id,
                        jsonrpc: protocol_js_1.WALLET_ABI_JSON_RPC_VERSION,
                        result: await bridge.processRequest(request.params),
                    };
            }
        },
    };
}
//# sourceMappingURL=wallet.js.map