import { TX_CREATE_ABI_VERSION, } from "./schema.js";
const DEFAULT_SEQUENCE = 0xffff_ffff;
export function generateRequestId() {
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
export function createSimfFinalizer(input) {
    return {
        type: "simf",
        source_simf: input.source_simf,
        internal_key: input.internal_key ?? "bip0341",
        arguments: Array.from(input.arguments),
        witness: Array.from(input.witness),
    };
}
export function createWalletInput(input) {
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
export function createProvidedInput(input) {
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
export function createScriptLock(script) {
    return {
        type: "script",
        script,
    };
}
export function createFinalizerLock(finalizer) {
    return {
        type: "finalizer",
        finalizer,
    };
}
export function createExplicitAsset(asset_id) {
    return {
        type: "asset_id",
        asset_id,
    };
}
export function createNewIssuanceAsset(input_index) {
    return {
        type: "new_issuance_asset",
        input_index,
    };
}
export function createNewIssuanceToken(input_index) {
    return {
        type: "new_issuance_token",
        input_index,
    };
}
export function createReIssuanceAsset(input_index) {
    return {
        type: "re_issuance_asset",
        input_index,
    };
}
function createWalletBlinder() {
    return "wallet";
}
export function createExplicitBlinder() {
    return "explicit";
}
export function createProvidedBlinder(pubkey) {
    return {
        provided: {
            pubkey,
        },
    };
}
export function createOutput(input) {
    return {
        id: input.id,
        amount_sat: input.amount_sat,
        lock: input.lock,
        asset: input.asset,
        blinder: input.blinder ?? createWalletBlinder(),
    };
}
export function createRuntimeParams(input) {
    return {
        inputs: input.inputs ?? [],
        outputs: input.outputs ?? [],
        ...(input.fee_rate_sat_kvb !== undefined
            ? { fee_rate_sat_kvb: input.fee_rate_sat_kvb }
            : {}),
        ...(input.lock_time !== undefined ? { lock_time: input.lock_time } : {}),
    };
}
export function createTxCreateRequest(input) {
    return {
        abi_version: input.abi_version ?? TX_CREATE_ABI_VERSION,
        request_id: input.request_id ?? generateRequestId(),
        network: input.network,
        params: input.params,
        broadcast: input.broadcast ?? false,
    };
}
//# sourceMappingURL=builders.js.map