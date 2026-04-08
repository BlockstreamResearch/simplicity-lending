"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletAbiSchemaError = exports.WALLET_ABI_NETWORKS = exports.TX_CREATE_ABI_VERSION = void 0;
exports.isWalletAbiNetwork = isWalletAbiNetwork;
exports.parseErrorInfo = parseErrorInfo;
exports.parseInternalKeySource = parseInternalKeySource;
exports.parseFinalizerSpec = parseFinalizerSpec;
exports.parseWalletAbiCapabilities = parseWalletAbiCapabilities;
exports.parseTxCreateRequest = parseTxCreateRequest;
exports.parseTxCreateResponse = parseTxCreateResponse;
exports.TX_CREATE_ABI_VERSION = "wallet-abi-0.1";
exports.WALLET_ABI_NETWORKS = [
    "liquid",
    "testnet-liquid",
    "localtest-liquid",
];
class WalletAbiSchemaError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletAbiSchemaError";
    }
}
exports.WalletAbiSchemaError = WalletAbiSchemaError;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expectRecord(value, context) {
    if (!isRecord(value)) {
        throw new WalletAbiSchemaError(`${context} must be an object`);
    }
    return value;
}
function expectString(value, context) {
    if (typeof value !== "string") {
        throw new WalletAbiSchemaError(`${context} must be a string`);
    }
    return value;
}
function expectNumber(value, context) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new WalletAbiSchemaError(`${context} must be a finite number`);
    }
    return value;
}
function expectBoolean(value, context) {
    if (typeof value !== "boolean") {
        throw new WalletAbiSchemaError(`${context} must be a boolean`);
    }
    return value;
}
function expectArray(value, context) {
    if (!Array.isArray(value)) {
        throw new WalletAbiSchemaError(`${context} must be an array`);
    }
    return value;
}
function isWalletAbiNetwork(value) {
    return (typeof value === "string" &&
        exports.WALLET_ABI_NETWORKS.includes(value));
}
function parseJsonValue(value, context) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return expectNumber(value, context);
    }
    if (Array.isArray(value)) {
        return value.map((entry, index) => parseJsonValue(entry, `${context}[${String(index)}]`));
    }
    return parseJsonObject(value, context);
}
function parseJsonObject(value, context) {
    const record = expectRecord(value, context);
    const parsed = {};
    for (const [key, entry] of Object.entries(record)) {
        parsed[key] = parseJsonValue(entry, `${context}.${key}`);
    }
    return parsed;
}
function parseNumberArray(value, context) {
    return expectArray(value, context).map((entry, index) => expectNumber(entry, `${context}[${String(index)}]`));
}
function parseTaprootIdentity(value) {
    const record = expectRecord(value, "taproot_identity");
    if (record.Seed !== undefined) {
        return {
            Seed: parseNumberArray(record.Seed, "taproot_identity.Seed"),
        };
    }
    if (record.ExternalXOnly !== undefined) {
        return {
            ExternalXOnly: expectString(record.ExternalXOnly, "taproot_identity.ExternalXOnly"),
        };
    }
    throw new WalletAbiSchemaError('taproot_identity must contain "Seed" or "ExternalXOnly"');
}
function parseTaprootPubkeyGen(value) {
    const record = expectRecord(value, "taproot_pubkey_gen");
    return {
        identity: parseTaprootIdentity(record.identity),
        pubkey: expectString(record.pubkey, "taproot_pubkey_gen.pubkey"),
        address: expectString(record.address, "taproot_pubkey_gen.address"),
    };
}
function parseAssetFilter(value) {
    if (value === "none") {
        return value;
    }
    const record = expectRecord(value, "wallet_source_filter.asset");
    const exact = expectRecord(record.exact, "wallet_source_filter.asset.exact");
    return {
        exact: {
            asset_id: expectString(exact.asset_id, "wallet_source_filter.asset.exact.asset_id"),
        },
    };
}
function parseAmountFilter(value) {
    if (value === "none") {
        return value;
    }
    const record = expectRecord(value, "wallet_source_filter.amount");
    if (record.exact !== undefined) {
        const exact = expectRecord(record.exact, "wallet_source_filter.amount.exact");
        return {
            exact: {
                amount_sat: expectNumber(exact.amount_sat, "wallet_source_filter.amount.exact.amount_sat"),
            },
        };
    }
    if (record.min !== undefined) {
        const min = expectRecord(record.min, "wallet_source_filter.amount.min");
        return {
            min: {
                amount_sat: expectNumber(min.amount_sat, "wallet_source_filter.amount.min.amount_sat"),
            },
        };
    }
    throw new WalletAbiSchemaError('wallet_source_filter.amount must be "none", "exact", or "min"');
}
function parseLockFilter(value) {
    if (value === "none") {
        return value;
    }
    const record = expectRecord(value, "wallet_source_filter.lock");
    const script = expectRecord(record.script, "wallet_source_filter.lock.script");
    return {
        script: {
            script: expectString(script.script, "wallet_source_filter.lock.script.script"),
        },
    };
}
function parseWalletSourceFilter(value) {
    const record = expectRecord(value, "wallet_source_filter");
    return {
        asset: parseAssetFilter(record.asset),
        amount: parseAmountFilter(record.amount),
        lock: parseLockFilter(record.lock),
    };
}
function parseUtxoSource(value) {
    const record = expectRecord(value, "input.utxo_source");
    if (record.wallet !== undefined) {
        const wallet = expectRecord(record.wallet, "input.utxo_source.wallet");
        return {
            wallet: {
                filter: parseWalletSourceFilter(wallet.filter),
            },
        };
    }
    if (record.provided !== undefined) {
        const provided = expectRecord(record.provided, "input.utxo_source.provided");
        return {
            provided: {
                outpoint: expectString(provided.outpoint, "input.utxo_source.provided.outpoint"),
            },
        };
    }
    throw new WalletAbiSchemaError('input.utxo_source must contain "wallet" or "provided"');
}
function parseInputIssuance(value) {
    const record = expectRecord(value, "input.issuance");
    const kind = expectString(record.kind, "input.issuance.kind");
    if (kind !== "new" && kind !== "reissue") {
        throw new WalletAbiSchemaError(`input.issuance.kind must be "new" or "reissue", got "${kind}"`);
    }
    return {
        kind,
        asset_amount_sat: expectNumber(record.asset_amount_sat, "input.issuance.asset_amount_sat"),
        token_amount_sat: expectNumber(record.token_amount_sat, "input.issuance.token_amount_sat"),
        entropy: parseNumberArray(record.entropy, "input.issuance.entropy"),
    };
}
function parseInputUnblinding(value) {
    if (value === "wallet" || value === "explicit") {
        return value;
    }
    const record = expectRecord(value, "input.unblinding");
    const provided = expectRecord(record.provided, "input.unblinding.provided");
    return {
        provided: {
            secret_key: expectString(provided.secret_key, "input.unblinding.provided.secret_key"),
        },
    };
}
function parseLockVariant(value) {
    const record = expectRecord(value, "output.lock");
    const type = expectString(record.type, "output.lock.type");
    if (type === "script") {
        return {
            type,
            script: expectString(record.script, "output.lock.script"),
        };
    }
    if (type === "finalizer") {
        return {
            type,
            finalizer: parseFinalizerSpec(record.finalizer),
        };
    }
    throw new WalletAbiSchemaError(`output.lock.type must be "script" or "finalizer", got "${type}"`);
}
function parseAssetVariant(value) {
    const record = expectRecord(value, "output.asset");
    const type = expectString(record.type, "output.asset.type");
    switch (type) {
        case "asset_id":
            return {
                type,
                asset_id: expectString(record.asset_id, "output.asset.asset_id"),
            };
        case "new_issuance_asset":
        case "new_issuance_token":
        case "re_issuance_asset":
            return {
                type,
                input_index: expectNumber(record.input_index, "output.asset.input_index"),
            };
        default:
            throw new WalletAbiSchemaError(`output.asset.type is unsupported: "${type}"`);
    }
}
function parseBlinderVariant(value) {
    if (value === "wallet" || value === "explicit") {
        return value;
    }
    const record = expectRecord(value, "output.blinder");
    const provided = expectRecord(record.provided, "output.blinder.provided");
    return {
        provided: {
            pubkey: expectString(provided.pubkey, "output.blinder.provided.pubkey"),
        },
    };
}
function parseInputSchema(value, context) {
    const record = expectRecord(value, context);
    return {
        id: expectString(record.id, `${context}.id`),
        utxo_source: parseUtxoSource(record.utxo_source),
        unblinding: parseInputUnblinding(record.unblinding),
        sequence: expectNumber(record.sequence, `${context}.sequence`),
        ...(record.issuance !== undefined
            ? { issuance: parseInputIssuance(record.issuance) }
            : {}),
        finalizer: parseFinalizerSpec(record.finalizer),
    };
}
function parseOutputSchema(value, context) {
    const record = expectRecord(value, context);
    return {
        id: expectString(record.id, `${context}.id`),
        amount_sat: expectNumber(record.amount_sat, `${context}.amount_sat`),
        lock: parseLockVariant(record.lock),
        asset: parseAssetVariant(record.asset),
        blinder: parseBlinderVariant(record.blinder),
    };
}
function parseLockTime(value) {
    const record = expectRecord(value, "runtime_params.lock_time");
    const hasBlocks = record.Blocks !== undefined;
    const hasSeconds = record.Seconds !== undefined;
    if (hasBlocks === hasSeconds) {
        throw new WalletAbiSchemaError('runtime_params.lock_time must contain exactly one of "Blocks" or "Seconds"');
    }
    if (hasBlocks) {
        return {
            Blocks: expectNumber(record.Blocks, "runtime_params.lock_time.Blocks"),
        };
    }
    return {
        Seconds: expectNumber(record.Seconds, "runtime_params.lock_time.Seconds"),
    };
}
function parseRuntimeParams(value) {
    const record = expectRecord(value, "tx_create_request.params");
    const inputs = expectArray(record.inputs, "tx_create_request.params.inputs");
    const outputs = expectArray(record.outputs, "tx_create_request.params.outputs");
    return {
        inputs: inputs.map((entry, index) => parseInputSchema(entry, `tx_create_request.params.inputs[${String(index)}]`)),
        outputs: outputs.map((entry, index) => parseOutputSchema(entry, `tx_create_request.params.outputs[${String(index)}]`)),
        ...(record.fee_rate_sat_kvb !== undefined
            ? {
                fee_rate_sat_kvb: expectNumber(record.fee_rate_sat_kvb, "tx_create_request.params.fee_rate_sat_kvb"),
            }
            : {}),
        ...(record.lock_time !== undefined
            ? { lock_time: parseLockTime(record.lock_time) }
            : {}),
    };
}
function parseTransactionInfo(value) {
    const record = expectRecord(value, "tx_create_response.transaction");
    return {
        tx_hex: expectString(record.tx_hex, "tx_create_response.transaction.tx_hex"),
        txid: expectString(record.txid, "tx_create_response.transaction.txid"),
    };
}
function parseErrorInfo(value) {
    const record = expectRecord(value, "error_info");
    return {
        code: expectString(record.code, "error_info.code"),
        message: expectString(record.message, "error_info.message"),
        ...(record.details !== undefined
            ? { details: parseJsonValue(record.details, "error_info.details") }
            : {}),
    };
}
function parseInternalKeySource(value) {
    if (value === "bip0341") {
        return value;
    }
    const record = expectRecord(value, "internal_key_source");
    const external = expectRecord(record.external, "internal_key_source.external");
    return {
        external: {
            key: parseTaprootPubkeyGen(external.key),
        },
    };
}
function parseFinalizerSpec(value) {
    const record = expectRecord(value, "finalizer");
    const type = expectString(record.type, "finalizer.type");
    if (type === "wallet") {
        return {
            type,
        };
    }
    if (type !== "simf") {
        throw new WalletAbiSchemaError(`finalizer.type must be "wallet" or "simf", got "${type}"`);
    }
    return {
        type,
        source_simf: expectString(record.source_simf, "finalizer.source_simf"),
        internal_key: parseInternalKeySource(record.internal_key),
        arguments: parseNumberArray(record.arguments, "finalizer.arguments"),
        witness: parseNumberArray(record.witness, "finalizer.witness"),
    };
}
function parseWalletAbiCapabilities(value) {
    const record = expectRecord(value, "wallet_abi_capabilities");
    const network = record.network;
    if (!isWalletAbiNetwork(network)) {
        throw new WalletAbiSchemaError("wallet_abi_capabilities.network must be a supported wallet ABI network");
    }
    return {
        abi_version: expectString(record.abi_version, "wallet_abi_capabilities.abi_version"),
        network,
        signer_receive_address: expectString(record.signer_receive_address, "wallet_abi_capabilities.signer_receive_address"),
        signing_x_only_pubkey: expectString(record.signing_x_only_pubkey, "wallet_abi_capabilities.signing_x_only_pubkey"),
    };
}
function parseTxCreateRequest(value) {
    const record = expectRecord(value, "tx_create_request");
    const network = record.network;
    if (!isWalletAbiNetwork(network)) {
        throw new WalletAbiSchemaError("tx_create_request.network must be a supported wallet ABI network");
    }
    return {
        abi_version: expectString(record.abi_version, "tx_create_request.abi_version"),
        request_id: expectString(record.request_id, "tx_create_request.request_id"),
        network,
        params: parseRuntimeParams(record.params),
        broadcast: expectBoolean(record.broadcast, "tx_create_request.broadcast"),
    };
}
function parseTxCreateResponse(value) {
    const record = expectRecord(value, "tx_create_response");
    const network = record.network;
    if (!isWalletAbiNetwork(network)) {
        throw new WalletAbiSchemaError("tx_create_response.network must be a supported wallet ABI network");
    }
    const base = {
        abi_version: expectString(record.abi_version, "tx_create_response.abi_version"),
        request_id: expectString(record.request_id, "tx_create_response.request_id"),
        network,
        ...(record.artifacts !== undefined
            ? {
                artifacts: parseJsonObject(record.artifacts, "tx_create_response.artifacts"),
            }
            : {}),
    };
    const status = expectString(record.status, "tx_create_response.status");
    if (status === "ok") {
        if (record.error !== undefined) {
            throw new WalletAbiSchemaError('tx_create_response with status "ok" must not include error');
        }
        return {
            ...base,
            status,
            transaction: parseTransactionInfo(record.transaction),
        };
    }
    if (status === "error") {
        if (record.transaction !== undefined) {
            throw new WalletAbiSchemaError('tx_create_response with status "error" must not include transaction');
        }
        return {
            ...base,
            status,
            error: parseErrorInfo(record.error),
        };
    }
    throw new WalletAbiSchemaError(`tx_create_response.status must be "ok" or "error", got "${status}"`);
}
//# sourceMappingURL=schema.js.map