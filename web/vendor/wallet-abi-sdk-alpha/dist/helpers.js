var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
export class WalletAbiHelperError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletAbiHelperError";
    }
}
let modulePromise;
async function getModule() {
    if (modulePromise === undefined) {
        modulePromise = (async () => {
            const imported = (await import(__rewriteRelativeImportExtension(new URL("./vendor/lwk_wasm/lwk_wasm.js", import.meta.url).href)));
            await imported.default();
            return imported;
        })();
    }
    return await modulePromise;
}
function resolveNetwork(wasm, network) {
    if (typeof network !== "string") {
        return network;
    }
    switch (network) {
        case "liquid":
            return wasm.Network.mainnet();
        case "testnet-liquid":
            return wasm.Network.testnet();
        case "localtest-liquid":
            return wasm.Network.regtestDefault();
    }
    throw new WalletAbiHelperError(`unsupported network "${network}"`);
}
function resolveXOnlyPublicKey(wasm, value) {
    return typeof value === "string"
        ? wasm.XOnlyPublicKey.fromString(value)
        : value;
}
function resolveContractHash(wasm, value) {
    return typeof value === "string"
        ? wasm.ContractHash.fromString(value)
        : value;
}
export async function loadWalletAbiLwkWasm() {
    return await getModule();
}
export async function createSimplicityArgumentsBuilder() {
    const wasm = await getModule();
    return new wasm.SimplicityArguments();
}
export async function createSimplicityWitnessValuesBuilder() {
    const wasm = await getModule();
    return new wasm.SimplicityWitnessValues();
}
export async function createLwkNetwork(network) {
    const wasm = await getModule();
    return resolveNetwork(wasm, network);
}
export async function createLwkXOnlyPublicKey(value) {
    const wasm = await getModule();
    return wasm.XOnlyPublicKey.fromString(value);
}
export async function serializeSimfArguments(resolved, runtime_arguments) {
    const wasm = await getModule();
    return wasm.walletAbiSerializeArguments(resolved, runtime_arguments);
}
export async function serializeSimfWitness(resolved, runtime_arguments) {
    const wasm = await getModule();
    return wasm.walletAbiSerializeWitness(resolved, runtime_arguments);
}
export async function createTaprootHandle(input) {
    const wasm = await getModule();
    return wasm.walletAbiCreateTaprootHandle(input.source_simf, input.resolved_arguments, resolveNetwork(wasm, input.network));
}
export async function createExternalTaprootHandle(input) {
    const wasm = await getModule();
    return wasm.walletAbiCreateExternalTaprootHandle(input.source_simf, input.resolved_arguments, resolveXOnlyPublicKey(wasm, input.x_only_public_key), resolveNetwork(wasm, input.network));
}
export async function verifyTaprootHandle(input) {
    const wasm = await getModule();
    return wasm.walletAbiVerifyTaprootHandle(input.handle, input.source_simf, input.resolved_arguments, resolveNetwork(wasm, input.network));
}
export async function generateIssuanceAssetEntropy(input) {
    const wasm = await getModule();
    const entropy = wasm.generateAssetEntropy(new wasm.OutPoint(input.outpoint), resolveContractHash(wasm, input.contract_hash));
    return entropy.toString();
}
export async function deriveAssetIdFromIssuance(input) {
    const wasm = await getModule();
    return wasm
        .assetIdFromIssuance(new wasm.OutPoint(input.outpoint), resolveContractHash(wasm, input.contract_hash))
        .toString();
}
export async function deriveReissuanceTokenFromIssuance(input) {
    const wasm = await getModule();
    return wasm
        .reissuanceTokenFromIssuance(new wasm.OutPoint(input.outpoint), resolveContractHash(wasm, input.contract_hash), input.is_confidential ?? false)
        .toString();
}
export async function createSimplicityP2trAddress(input) {
    const wasm = await getModule();
    const program = wasm.SimplicityProgram.load(input.source_simf, input.resolved_arguments);
    return program
        .createP2trAddress(resolveXOnlyPublicKey(wasm, input.internal_key), resolveNetwork(wasm, input.network))
        .toString();
}
//# sourceMappingURL=helpers.js.map