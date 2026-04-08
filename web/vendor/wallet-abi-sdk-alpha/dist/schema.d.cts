export declare const TX_CREATE_ABI_VERSION = "wallet-abi-0.1";
export declare const WALLET_ABI_NETWORKS: readonly ["liquid", "testnet-liquid", "localtest-liquid"];
export type WalletAbiNetwork = (typeof WALLET_ABI_NETWORKS)[number];
export type WalletAbiTxid = string;
export type WalletAbiAssetId = string;
export type WalletAbiAddress = string;
export type WalletAbiScriptHex = string;
export type WalletAbiPublicKeyHex = string;
export type WalletAbiSecretKeyHex = string;
export type WalletAbiXOnlyPublicKeyHex = string;
export type WalletAbiOutPoint = string;
export type WalletAbiUuid = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
    [key: string]: JsonValue;
}
export type WalletAbiErrorCode = "invalid_request" | "serde" | "program_error" | "derivation" | "try_from_int" | "funding" | "invalid_signer_config" | "invalid_response" | "pset" | "pset_blind" | "amount_proof_verification" | "invalid_finalization_steps" | (string & {});
export interface ErrorInfo {
    code: WalletAbiErrorCode;
    message: string;
    details?: JsonValue;
}
export type WalletAbiLockTime = {
    Blocks: number;
} | {
    Seconds: number;
};
export type AssetFilter = "none" | {
    exact: {
        asset_id: WalletAbiAssetId;
    };
};
export type AmountFilter = "none" | {
    exact: {
        amount_sat: number;
    };
} | {
    min: {
        amount_sat: number;
    };
};
export type LockFilter = "none" | {
    script: {
        script: WalletAbiScriptHex;
    };
};
export interface WalletSourceFilter {
    asset: AssetFilter;
    amount: AmountFilter;
    lock: LockFilter;
}
export type UTXOSource = {
    wallet: {
        filter: WalletSourceFilter;
    };
} | {
    provided: {
        outpoint: WalletAbiOutPoint;
    };
};
export type InputIssuanceKind = "new" | "reissue";
export interface InputIssuance {
    kind: InputIssuanceKind;
    asset_amount_sat: number;
    token_amount_sat: number;
    entropy: number[];
}
export type TaprootIdentity = {
    Seed: number[];
} | {
    ExternalXOnly: WalletAbiXOnlyPublicKeyHex;
};
export interface TaprootPubkeyGen {
    identity: TaprootIdentity;
    pubkey: WalletAbiPublicKeyHex;
    address: WalletAbiAddress;
}
export type InternalKeySource = "bip0341" | {
    external: {
        key: TaprootPubkeyGen;
    };
};
export type FinalizerSpec = {
    type: "wallet";
} | {
    type: "simf";
    source_simf: string;
    internal_key: InternalKeySource;
    arguments: number[];
    witness: number[];
};
export type InputUnblinding = "wallet" | "explicit" | {
    provided: {
        secret_key: WalletAbiSecretKeyHex;
    };
};
export interface InputSchema {
    id: string;
    utxo_source: UTXOSource;
    unblinding: InputUnblinding;
    sequence: number;
    issuance?: InputIssuance;
    finalizer: FinalizerSpec;
}
export type LockVariant = {
    type: "script";
    script: WalletAbiScriptHex;
} | {
    type: "finalizer";
    finalizer: FinalizerSpec;
};
export type AssetVariant = {
    type: "asset_id";
    asset_id: WalletAbiAssetId;
} | {
    type: "new_issuance_asset";
    input_index: number;
} | {
    type: "new_issuance_token";
    input_index: number;
} | {
    type: "re_issuance_asset";
    input_index: number;
};
export type BlinderVariant = "wallet" | "explicit" | {
    provided: {
        pubkey: WalletAbiPublicKeyHex;
    };
};
export interface OutputSchema {
    id: string;
    amount_sat: number;
    lock: LockVariant;
    asset: AssetVariant;
    blinder: BlinderVariant;
}
export interface RuntimeParams {
    inputs: InputSchema[];
    outputs: OutputSchema[];
    fee_rate_sat_kvb?: number;
    lock_time?: WalletAbiLockTime;
}
export interface TxCreateRequest {
    abi_version: string;
    request_id: WalletAbiUuid;
    network: WalletAbiNetwork;
    params: RuntimeParams;
    broadcast: boolean;
}
export interface TransactionInfo {
    tx_hex: string;
    txid: WalletAbiTxid;
}
export type TxCreateArtifacts = Record<string, JsonValue>;
export type WalletAbiStatus = "ok" | "error";
interface TxCreateResponseBase {
    abi_version: string;
    request_id: WalletAbiUuid;
    network: WalletAbiNetwork;
    artifacts?: TxCreateArtifacts;
}
export interface TxCreateOkResponse extends TxCreateResponseBase {
    status: "ok";
    transaction: TransactionInfo;
    error?: never;
}
export interface TxCreateErrorResponse extends TxCreateResponseBase {
    status: "error";
    error: ErrorInfo;
    transaction?: never;
}
export type TxCreateResponse = TxCreateOkResponse | TxCreateErrorResponse;
export type RuntimeSimfValue = {
    new_issuance_asset: {
        input_index: number;
    };
} | {
    new_issuance_token: {
        input_index: number;
    };
};
export type RuntimeSimfWitness = {
    sig_hash_all: {
        name: string;
        public_key: WalletAbiXOnlyPublicKeyHex;
    };
};
export interface SimfArguments {
    resolved: Record<string, JsonValue>;
    runtime_arguments: Record<string, RuntimeSimfValue>;
}
export interface SimfWitness {
    resolved: Record<string, JsonValue>;
    runtime_arguments: RuntimeSimfWitness[];
}
export interface WalletAbiCapabilities {
    abi_version: string;
    network: WalletAbiNetwork;
    signer_receive_address: WalletAbiAddress;
    signing_x_only_pubkey: WalletAbiXOnlyPublicKeyHex;
}
export declare class WalletAbiSchemaError extends Error {
    constructor(message: string);
}
export declare function isWalletAbiNetwork(value: unknown): value is WalletAbiNetwork;
export declare function parseErrorInfo(value: unknown): ErrorInfo;
export declare function parseInternalKeySource(value: unknown): InternalKeySource;
export declare function parseFinalizerSpec(value: unknown): FinalizerSpec;
export declare function parseWalletAbiCapabilities(value: unknown): WalletAbiCapabilities;
export declare function parseTxCreateRequest(value: unknown): TxCreateRequest;
export declare function parseTxCreateResponse(value: unknown): TxCreateResponse;
export {};
