"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletAbiHelperError = void 0;
exports.loadWalletAbiLwkWasm = loadWalletAbiLwkWasm;
exports.createSimplicityArgumentsBuilder = createSimplicityArgumentsBuilder;
exports.createSimplicityWitnessValuesBuilder = createSimplicityWitnessValuesBuilder;
exports.createLwkNetwork = createLwkNetwork;
exports.createLwkXOnlyPublicKey = createLwkXOnlyPublicKey;
exports.serializeSimfArguments = serializeSimfArguments;
exports.serializeSimfWitness = serializeSimfWitness;
exports.createTaprootHandle = createTaprootHandle;
exports.createExternalTaprootHandle = createExternalTaprootHandle;
exports.verifyTaprootHandle = verifyTaprootHandle;
exports.generateIssuanceAssetEntropy = generateIssuanceAssetEntropy;
exports.deriveAssetIdFromIssuance = deriveAssetIdFromIssuance;
exports.deriveReissuanceTokenFromIssuance = deriveReissuanceTokenFromIssuance;
exports.createSimplicityP2trAddress = createSimplicityP2trAddress;
class WalletAbiHelperError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletAbiHelperError";
    }
}
exports.WalletAbiHelperError = WalletAbiHelperError;
let modulePromise;
async function getModule() {
    if (modulePromise === undefined) {
        modulePromise = (async () => {
            const imported = (await Promise.resolve(`${__rewriteRelativeImportExtension(new URL("./vendor/lwk_wasm/lwk_wasm.js", require("url").pathToFileURL(__filename)).href)}`).then(s => __importStar(require(s))));
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
async function loadWalletAbiLwkWasm() {
    return await getModule();
}
async function createSimplicityArgumentsBuilder() {
    const wasm = await getModule();
    return new wasm.SimplicityArguments();
}
async function createSimplicityWitnessValuesBuilder() {
    const wasm = await getModule();
    return new wasm.SimplicityWitnessValues();
}
async function createLwkNetwork(network) {
    const wasm = await getModule();
    return resolveNetwork(wasm, network);
}
async function createLwkXOnlyPublicKey(value) {
    const wasm = await getModule();
    return wasm.XOnlyPublicKey.fromString(value);
}
async function serializeSimfArguments(resolved, runtime_arguments) {
    const wasm = await getModule();
    return wasm.walletAbiSerializeArguments(resolved, runtime_arguments);
}
async function serializeSimfWitness(resolved, runtime_arguments) {
    const wasm = await getModule();
    return wasm.walletAbiSerializeWitness(resolved, runtime_arguments);
}
async function createTaprootHandle(input) {
    const wasm = await getModule();
    return wasm.walletAbiCreateTaprootHandle(input.source_simf, input.resolved_arguments, resolveNetwork(wasm, input.network));
}
async function createExternalTaprootHandle(input) {
    const wasm = await getModule();
    return wasm.walletAbiCreateExternalTaprootHandle(input.source_simf, input.resolved_arguments, resolveXOnlyPublicKey(wasm, input.x_only_public_key), resolveNetwork(wasm, input.network));
}
async function verifyTaprootHandle(input) {
    const wasm = await getModule();
    return wasm.walletAbiVerifyTaprootHandle(input.handle, input.source_simf, input.resolved_arguments, resolveNetwork(wasm, input.network));
}
async function generateIssuanceAssetEntropy(input) {
    const wasm = await getModule();
    const entropy = wasm.generateAssetEntropy(new wasm.OutPoint(input.outpoint), resolveContractHash(wasm, input.contract_hash));
    return entropy.toString();
}
async function deriveAssetIdFromIssuance(input) {
    const wasm = await getModule();
    return wasm
        .assetIdFromIssuance(new wasm.OutPoint(input.outpoint), resolveContractHash(wasm, input.contract_hash))
        .toString();
}
async function deriveReissuanceTokenFromIssuance(input) {
    const wasm = await getModule();
    return wasm
        .reissuanceTokenFromIssuance(new wasm.OutPoint(input.outpoint), resolveContractHash(wasm, input.contract_hash), input.is_confidential ?? false)
        .toString();
}
async function createSimplicityP2trAddress(input) {
    const wasm = await getModule();
    const program = wasm.SimplicityProgram.load(input.source_simf, input.resolved_arguments);
    return program
        .createP2trAddress(resolveXOnlyPublicKey(wasm, input.internal_key), resolveNetwork(wasm, input.network))
        .toString();
}
//# sourceMappingURL=helpers.js.map