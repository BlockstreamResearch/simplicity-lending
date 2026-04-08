"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRequestId = generateRequestId;
exports.createSimfFinalizer = createSimfFinalizer;
exports.createWalletInput = createWalletInput;
exports.createProvidedInput = createProvidedInput;
exports.createScriptLock = createScriptLock;
exports.createFinalizerLock = createFinalizerLock;
exports.createExplicitAsset = createExplicitAsset;
exports.createNewIssuanceAsset = createNewIssuanceAsset;
exports.createNewIssuanceToken = createNewIssuanceToken;
exports.createReIssuanceAsset = createReIssuanceAsset;
exports.createExplicitBlinder = createExplicitBlinder;
exports.createProvidedBlinder = createProvidedBlinder;
exports.createOutput = createOutput;
exports.createRuntimeParams = createRuntimeParams;
exports.createTxCreateRequest = createTxCreateRequest;
const schema_js_1 = require("./schema.cjs");
const DEFAULT_SEQUENCE = 0xffff_ffff;
function generateRequestId() {
    const cryptoApi = Reflect.get(globalThis, "crypto");
    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    throw new Error("Wallet ABI SDK requires globalThis.crypto.randomUUID() support.");
}
function createWalletSourceFilter(overrides = {}) {
    return {
        asset: "none",
        amount: "none",
        lock: "none",
        ...overrides,
    };
}
function createWalletFinalizer() {
    return {
        type: "wallet",
    };
}
function createSimfFinalizer(input) {
    return {
        type: "simf",
        source_simf: input.source_simf,
        internal_key: input.internal_key ?? "bip0341",
        arguments: Array.from(input.arguments),
        witness: Array.from(input.witness),
    };
}
function createWalletInput(input) {
    return {
        id: input.id,
        utxo_source: {
            wallet: {
                filter: createWalletSourceFilter(input.filter),
            },
        },
        unblinding: input.unblinding ?? "wallet",
        sequence: input.sequence ?? DEFAULT_SEQUENCE,
        ...(input.issuance !== undefined ? { issuance: input.issuance } : {}),
        finalizer: input.finalizer ?? createWalletFinalizer(),
    };
}
function createProvidedInput(input) {
    return {
        id: input.id,
        utxo_source: {
            provided: {
                outpoint: input.outpoint,
            },
        },
        unblinding: input.unblinding ?? "explicit",
        sequence: input.sequence ?? DEFAULT_SEQUENCE,
        ...(input.issuance !== undefined ? { issuance: input.issuance } : {}),
        finalizer: input.finalizer ?? createWalletFinalizer(),
    };
}
function createScriptLock(script) {
    return {
        type: "script",
        script,
    };
}
function createFinalizerLock(finalizer) {
    return {
        type: "finalizer",
        finalizer,
    };
}
function createExplicitAsset(asset_id) {
    return {
        type: "asset_id",
        asset_id,
    };
}
function createNewIssuanceAsset(input_index) {
    return {
        type: "new_issuance_asset",
        input_index,
    };
}
function createNewIssuanceToken(input_index) {
    return {
        type: "new_issuance_token",
        input_index,
    };
}
function createReIssuanceAsset(input_index) {
    return {
        type: "re_issuance_asset",
        input_index,
    };
}
function createWalletBlinder() {
    return "wallet";
}
function createExplicitBlinder() {
    return "explicit";
}
function createProvidedBlinder(pubkey) {
    return {
        provided: {
            pubkey,
        },
    };
}
function createOutput(input) {
    return {
        id: input.id,
        amount_sat: input.amount_sat,
        lock: input.lock,
        asset: input.asset,
        blinder: input.blinder ?? createWalletBlinder(),
    };
}
function createRuntimeParams(input) {
    return {
        inputs: input.inputs ?? [],
        outputs: input.outputs ?? [],
        ...(input.fee_rate_sat_kvb !== undefined
            ? { fee_rate_sat_kvb: input.fee_rate_sat_kvb }
            : {}),
        ...(input.lock_time !== undefined ? { lock_time: input.lock_time } : {}),
    };
}
function createTxCreateRequest(input) {
    return {
        abi_version: input.abi_version ?? schema_js_1.TX_CREATE_ABI_VERSION,
        request_id: input.request_id ?? generateRequestId(),
        network: input.network,
        params: input.params,
        broadcast: input.broadcast ?? false,
    };
}
//# sourceMappingURL=builders.js.map