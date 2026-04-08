import type { RuntimeSimfValue, RuntimeSimfWitness, TaprootPubkeyGen, WalletAbiAssetId, WalletAbiNetwork } from "./schema.js";
export interface WalletAbiWasmNetwork {
    toString(): string;
}
export interface WalletAbiWasmXOnlyPublicKey {
    toString(): string;
}
export type WalletAbiWasmTypedValue = object;
export interface WalletAbiWasmSimplicityArguments {
    addValue(name: string, value: WalletAbiWasmTypedValue): WalletAbiWasmSimplicityArguments;
}
export interface WalletAbiWasmSimplicityWitnessValues {
    addValue(name: string, value: WalletAbiWasmTypedValue): WalletAbiWasmSimplicityWitnessValues;
}
interface WalletAbiAddressLike {
    toString(): string;
}
type WalletAbiWasmOutPoint = object;
interface WalletAbiWasmContractHash {
    toString(): string;
}
interface WalletAbiWasmAssetId {
    toString(): string;
}
interface WalletAbiWasmProgram {
    createP2trAddress(internal_key: WalletAbiWasmXOnlyPublicKey, network: WalletAbiWasmNetwork): WalletAbiAddressLike;
}
export interface WalletAbiLwkWasmModule {
    default(init?: unknown): Promise<unknown>;
    SimplicityArguments: new () => WalletAbiWasmSimplicityArguments;
    SimplicityWitnessValues: new () => WalletAbiWasmSimplicityWitnessValues;
    SimplicityTypedValue: {
        fromU32(value: number): WalletAbiWasmTypedValue;
        fromU256Hex(value: string): WalletAbiWasmTypedValue;
        fromByteArrayHex(value: string): WalletAbiWasmTypedValue;
    };
    SimplicityProgram: {
        load(source: string, arguments_: WalletAbiWasmSimplicityArguments): WalletAbiWasmProgram;
    };
    XOnlyPublicKey: {
        fromString(value: string): WalletAbiWasmXOnlyPublicKey;
    };
    Network: {
        mainnet(): WalletAbiWasmNetwork;
        testnet(): WalletAbiWasmNetwork;
        regtestDefault(): WalletAbiWasmNetwork;
    };
    OutPoint: new (value: string) => WalletAbiWasmOutPoint;
    ContractHash: {
        fromString(value: string): WalletAbiWasmContractHash;
    };
    walletAbiSerializeArguments(resolved: WalletAbiWasmSimplicityArguments, runtime_arguments: Record<string, RuntimeSimfValue>): Uint8Array;
    walletAbiSerializeWitness(resolved: WalletAbiWasmSimplicityWitnessValues, runtime_arguments: RuntimeSimfWitness[]): Uint8Array;
    walletAbiCreateTaprootHandle(source_simf: string, resolved_arguments: WalletAbiWasmSimplicityArguments, network: WalletAbiWasmNetwork): {
        handle: string;
        key: TaprootPubkeyGen;
    };
    walletAbiCreateExternalTaprootHandle(source_simf: string, resolved_arguments: WalletAbiWasmSimplicityArguments, x_only_public_key: WalletAbiWasmXOnlyPublicKey, network: WalletAbiWasmNetwork): {
        handle: string;
        key: TaprootPubkeyGen;
    };
    walletAbiVerifyTaprootHandle(handle: string, source_simf: string, resolved_arguments: WalletAbiWasmSimplicityArguments, network: WalletAbiWasmNetwork): {
        handle: string;
        key: TaprootPubkeyGen;
    };
    generateAssetEntropy(outpoint: WalletAbiWasmOutPoint, contract_hash: WalletAbiWasmContractHash): WalletAbiWasmContractHash;
    assetIdFromIssuance(outpoint: WalletAbiWasmOutPoint, contract_hash: WalletAbiWasmContractHash): WalletAbiWasmAssetId;
    reissuanceTokenFromIssuance(outpoint: WalletAbiWasmOutPoint, contract_hash: WalletAbiWasmContractHash, is_confidential: boolean): WalletAbiWasmAssetId;
}
export interface WalletAbiTaprootHandleResult {
    handle: string;
    key: TaprootPubkeyGen;
}
export declare class WalletAbiHelperError extends Error {
    constructor(message: string);
}
export declare function loadWalletAbiLwkWasm(): Promise<WalletAbiLwkWasmModule>;
export declare function createSimplicityArgumentsBuilder(): Promise<WalletAbiWasmSimplicityArguments>;
export declare function createSimplicityWitnessValuesBuilder(): Promise<WalletAbiWasmSimplicityWitnessValues>;
export declare function createLwkNetwork(network: WalletAbiNetwork): Promise<WalletAbiWasmNetwork>;
export declare function createLwkXOnlyPublicKey(value: string): Promise<WalletAbiWasmXOnlyPublicKey>;
export declare function serializeSimfArguments(resolved: WalletAbiWasmSimplicityArguments, runtime_arguments: Record<string, RuntimeSimfValue>): Promise<Uint8Array>;
export declare function serializeSimfWitness(resolved: WalletAbiWasmSimplicityWitnessValues, runtime_arguments: RuntimeSimfWitness[]): Promise<Uint8Array>;
export declare function createTaprootHandle(input: {
    source_simf: string;
    resolved_arguments: WalletAbiWasmSimplicityArguments;
    network: WalletAbiNetwork | WalletAbiWasmNetwork;
}): Promise<WalletAbiTaprootHandleResult>;
export declare function createExternalTaprootHandle(input: {
    source_simf: string;
    resolved_arguments: WalletAbiWasmSimplicityArguments;
    x_only_public_key: string | WalletAbiWasmXOnlyPublicKey;
    network: WalletAbiNetwork | WalletAbiWasmNetwork;
}): Promise<WalletAbiTaprootHandleResult>;
export declare function verifyTaprootHandle(input: {
    handle: string;
    source_simf: string;
    resolved_arguments: WalletAbiWasmSimplicityArguments;
    network: WalletAbiNetwork | WalletAbiWasmNetwork;
}): Promise<WalletAbiTaprootHandleResult>;
export declare function generateIssuanceAssetEntropy(input: {
    outpoint: string;
    contract_hash: string | WalletAbiWasmContractHash;
}): Promise<string>;
export declare function deriveAssetIdFromIssuance(input: {
    outpoint: string;
    contract_hash: string | WalletAbiWasmContractHash;
}): Promise<WalletAbiAssetId>;
export declare function deriveReissuanceTokenFromIssuance(input: {
    outpoint: string;
    contract_hash: string | WalletAbiWasmContractHash;
    is_confidential?: boolean;
}): Promise<WalletAbiAssetId>;
export declare function createSimplicityP2trAddress(input: {
    source_simf: string;
    resolved_arguments: WalletAbiWasmSimplicityArguments;
    internal_key: string | WalletAbiWasmXOnlyPublicKey;
    network: WalletAbiNetwork | WalletAbiWasmNetwork;
}): Promise<string>;
export {};
