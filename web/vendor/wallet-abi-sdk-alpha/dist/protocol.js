import { parseTxCreateRequest, parseTxCreateResponse, } from "./schema.js";
export const WALLET_ABI_JSON_RPC_VERSION = "2.0";
export const GET_SIGNER_RECEIVE_ADDRESS_METHOD = "get_signer_receive_address";
export const GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD = "get_raw_signing_x_only_pubkey";
export const WALLET_ABI_PROCESS_REQUEST_METHOD = "wallet_abi_process_request";
export const WALLET_ABI_METHODS = [
    GET_SIGNER_RECEIVE_ADDRESS_METHOD,
    GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD,
    WALLET_ABI_PROCESS_REQUEST_METHOD,
];
export class WalletAbiProtocolError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletAbiProtocolError";
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expectRecord(value, context) {
    if (!isRecord(value)) {
        throw new WalletAbiProtocolError(`${context} must be an object`);
    }
    return value;
}
function expectNumber(value, context) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new WalletAbiProtocolError(`${context} must be a finite number`);
    }
    return value;
}
function expectString(value, context) {
    if (typeof value !== "string") {
        throw new WalletAbiProtocolError(`${context} must be a string`);
    }
    return value;
}
function expectJsonRpcVersion(value, context) {
    if (value !== WALLET_ABI_JSON_RPC_VERSION) {
        throw new WalletAbiProtocolError(`${context} must be "${WALLET_ABI_JSON_RPC_VERSION}"`);
    }
}
function expectMethod(value, context) {
    const method = expectString(value, context);
    if (!WALLET_ABI_METHODS.includes(method)) {
        throw new WalletAbiProtocolError(`${context} must be a supported Wallet ABI method`);
    }
    return method;
}
function expectEmptyParams(value, context) {
    if (value === undefined) {
        return undefined;
    }
    const record = expectRecord(value, context);
    if (Object.keys(record).length > 0) {
        throw new WalletAbiProtocolError(`${context} must be empty`);
    }
    return {};
}
function parseSignerReceiveAddressResult(value, context) {
    const record = expectRecord(value, context);
    return {
        signer_receive_address: expectString(record.signer_receive_address, `${context}.signer_receive_address`),
    };
}
function parseRawSigningXOnlyPubkeyResult(value, context) {
    const record = expectRecord(value, context);
    return {
        raw_signing_x_only_pubkey: expectString(record.raw_signing_x_only_pubkey, `${context}.raw_signing_x_only_pubkey`),
    };
}
export function createGetSignerReceiveAddressRequest(id) {
    return {
        id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        method: GET_SIGNER_RECEIVE_ADDRESS_METHOD,
    };
}
export function createGetRawSigningXOnlyPubkeyRequest(id) {
    return {
        id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        method: GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD,
    };
}
export function createProcessRequest(id, params) {
    return {
        id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        method: WALLET_ABI_PROCESS_REQUEST_METHOD,
        params,
    };
}
export function createJsonRpcSuccessResponse(request, result) {
    return {
        id: request.id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        result,
    };
}
export function isJsonRpcErrorResponse(value) {
    return isRecord(value) && isRecord(value.error);
}
export function isWalletAbiGetSignerReceiveAddressResponse(value) {
    return (isRecord(value) &&
        !isJsonRpcErrorResponse(value) &&
        isRecord(value.result) &&
        typeof value.result.signer_receive_address === "string");
}
export function isWalletAbiGetRawSigningXOnlyPubkeyResponse(value) {
    return (isRecord(value) &&
        !isJsonRpcErrorResponse(value) &&
        isRecord(value.result) &&
        typeof value.result.raw_signing_x_only_pubkey === "string");
}
export function isWalletAbiProcessResponse(value) {
    return (isRecord(value) &&
        !isJsonRpcErrorResponse(value) &&
        isRecord(value.result) &&
        typeof value.result.status === "string");
}
export function parseWalletAbiJsonRpcRequest(value) {
    const record = expectRecord(value, "wallet_abi_json_rpc_request");
    const id = expectNumber(record.id, "wallet_abi_json_rpc_request.id");
    expectJsonRpcVersion(record.jsonrpc, "wallet_abi_json_rpc_request.jsonrpc");
    const method = expectMethod(record.method, "wallet_abi_json_rpc_request.method");
    if (method === GET_SIGNER_RECEIVE_ADDRESS_METHOD) {
        const params = record.params === undefined
            ? undefined
            : expectEmptyParams(record.params, "wallet_abi_json_rpc_request.params");
        return params === undefined
            ? {
                id,
                jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                method,
            }
            : {
                id,
                jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                method,
                params,
            };
    }
    if (method === GET_RAW_SIGNING_X_ONLY_PUBKEY_METHOD) {
        const params = record.params === undefined
            ? undefined
            : expectEmptyParams(record.params, "wallet_abi_json_rpc_request.params");
        return params === undefined
            ? {
                id,
                jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                method,
            }
            : {
                id,
                jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                method,
                params,
            };
    }
    return {
        id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        method,
        params: parseTxCreateRequest(record.params),
    };
}
export function parseWalletAbiJsonRpcResponse(value) {
    const record = expectRecord(value, "wallet_abi_json_rpc_response");
    const id = expectNumber(record.id, "wallet_abi_json_rpc_response.id");
    expectJsonRpcVersion(record.jsonrpc, "wallet_abi_json_rpc_response.jsonrpc");
    if (record.error !== undefined) {
        const error = expectRecord(record.error, "wallet_abi_json_rpc_response.error");
        return {
            id,
            jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
            error: {
                code: expectNumber(error.code, "wallet_abi_json_rpc_response.error.code"),
                message: expectString(error.message, "wallet_abi_json_rpc_response.error.message"),
            },
        };
    }
    if (record.result === undefined) {
        throw new WalletAbiProtocolError("wallet_abi_json_rpc_response.result must be present when error is absent");
    }
    if (isRecord(record.result)) {
        if ("signer_receive_address" in record.result) {
            return {
                id,
                jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                result: parseSignerReceiveAddressResult(record.result, "wallet_abi_json_rpc_response.result"),
            };
        }
        if ("raw_signing_x_only_pubkey" in record.result) {
            return {
                id,
                jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
                result: parseRawSigningXOnlyPubkeyResult(record.result, "wallet_abi_json_rpc_response.result"),
            };
        }
    }
    return {
        id,
        jsonrpc: WALLET_ABI_JSON_RPC_VERSION,
        result: parseTxCreateResponse(record.result),
    };
}
//# sourceMappingURL=protocol.js.map