import { type AssetVariant, type BlinderVariant, type FinalizerSpec, type InputSchema, type InputUnblinding, type InternalKeySource, type LockVariant, type OutputSchema, type RuntimeParams, type TxCreateRequest, type WalletAbiLockTime, type WalletAbiNetwork, type WalletSourceFilter } from "./schema.js";
export declare function generateRequestId(): string;
export declare function createSimfFinalizer(input: {
    source_simf: string;
    arguments: Uint8Array | number[];
    witness: Uint8Array | number[];
    internal_key?: InternalKeySource;
}): FinalizerSpec;
export declare function createWalletInput(input: {
    id: string;
    filter?: Partial<WalletSourceFilter>;
    unblinding?: InputUnblinding;
    sequence?: number;
    finalizer?: FinalizerSpec;
    issuance?: InputSchema["issuance"];
}): InputSchema;
export declare function createProvidedInput(input: {
    id: string;
    outpoint: string;
    unblinding?: InputUnblinding;
    sequence?: number;
    finalizer?: FinalizerSpec;
    issuance?: InputSchema["issuance"];
}): InputSchema;
export declare function createScriptLock(script: string): LockVariant;
export declare function createFinalizerLock(finalizer: FinalizerSpec): LockVariant;
export declare function createExplicitAsset(asset_id: string): AssetVariant;
export declare function createNewIssuanceAsset(input_index: number): AssetVariant;
export declare function createNewIssuanceToken(input_index: number): AssetVariant;
export declare function createReIssuanceAsset(input_index: number): AssetVariant;
export declare function createExplicitBlinder(): BlinderVariant;
export declare function createProvidedBlinder(pubkey: string): BlinderVariant;
export declare function createOutput(input: {
    id: string;
    amount_sat: number;
    lock: LockVariant;
    asset: AssetVariant;
    blinder?: BlinderVariant;
}): OutputSchema;
export declare function createRuntimeParams(input: {
    inputs?: InputSchema[];
    outputs?: OutputSchema[];
    fee_rate_sat_kvb?: number;
    lock_time?: WalletAbiLockTime;
}): RuntimeParams;
export declare function createTxCreateRequest(input: {
    network: WalletAbiNetwork;
    params: RuntimeParams;
    broadcast?: boolean;
    request_id?: string;
    abi_version?: string;
}): TxCreateRequest;
