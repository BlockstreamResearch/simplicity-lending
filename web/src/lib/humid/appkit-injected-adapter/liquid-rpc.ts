// Dapp-facing wire shapes for the ten Liquid Wallet RPC methods: the `*Params` a dapp builds and the
// `*Result` the wallet returns, plus the small const enums a dapp needs to construct those params.
// Internal branded ids (asset / chain) are surfaced here as plain `string`.

/* ---------- getBalance ---------- */

/** Balance query for the policy asset by default, or a specific ELIP-0144 asset id. */
export type LiquidGetBalanceParams = {
	assetId?: string;
};

/** Wallet-computed balance (base-unit string) for one asset, with the account and chain it came from. */
export type LiquidGetBalanceResult = {
	accountIdentifier: string;
	assetId: string;
	balance: string;
	chainId: string;
	policyAssetId: string;
};

/* ---------- getUTXOs ---------- */

/** UTXO query for the policy asset by default, or a specific ELIP-0144 asset id. */
export type LiquidGetUTXOsParams = {
	assetId?: string;
};

/** A single wallet UTXO with the safe subset of its output data. */
export type LiquidUTXO = {
	address: string;
	amount: string;
	assetId: string;
	confidential: boolean;
	scriptPubKey: string;
	spendable: boolean;
	txid: string;
	txOut: string;
	vout: number;
};

/** The wallet's UTXO set for one asset. */
export type LiquidGetUTXOsResult = {
	accountIdentifier: string;
	assetId: string;
	chainId: string;
	policyAssetId: string;
	utxos: LiquidUTXO[];
};

/* ---------- getWalletDescriptor ---------- */

export const LIQUID_DESCRIPTOR_TYPES = {
	PUBLIC_CONFIDENTIAL_DESCRIPTOR: "publicConfidentialDescriptor",
	PUBLIC_WALLET_DESCRIPTOR: "publicWalletDescriptor",
} as const;

export const LIQUID_DESCRIPTOR_FORMATS = {
	BIP380_BIP389_MULTIPATH: "bip380-bip389-multipath",
	BIP380_SPLIT_BRANCHES: "bip380-split-branches",
	ELIP150_PUBLIC_CT_BIP389_MULTIPATH: "elip150-public-ct-bip389-multipath",
	ELIP150_PUBLIC_CT_SPLIT_BRANCHES: "elip150-public-ct-split-branches",
} as const;

export type LiquidDescriptorType =
	(typeof LIQUID_DESCRIPTOR_TYPES)[keyof typeof LIQUID_DESCRIPTOR_TYPES];

export type LiquidDescriptorFormat =
	(typeof LIQUID_DESCRIPTOR_FORMATS)[keyof typeof LIQUID_DESCRIPTOR_FORMATS];

export type LiquidGetWalletDescriptorParams = {
	descriptorFormat?: Array<{
		format: LiquidDescriptorFormat | string;
	}>;
	descriptorType: LiquidDescriptorType;
};

/** One branch of a split-layout descriptor, with its address-index wildcard. */
export type LiquidDescriptorBranch = {
	addressIndex: "*";
	branch: "external" | "internal";
	change: 0 | 1;
};

/** One branch of a split-layout descriptor, rendered as a concrete descriptor string. */
export type LiquidDescriptorBranchDescriptor = {
	branch: "external" | "internal";
	change: 0 | 1;
	descriptor: string;
};

/** A single descriptor entry: either a multipath descriptor or per-branch split descriptors. */
export type LiquidWalletDescriptorEntry = {
	branchDescriptors?: LiquidDescriptorBranchDescriptor[];
	branches?: LiquidDescriptorBranch[];
	branchLayout: "multipath" | "split";
	canDeriveConfidentialAddresses: boolean;
	canDeriveScriptPubKeys: boolean;
	canUnblindOutputs: false;
	descriptor?: string;
	descriptorType: LiquidDescriptorType;
	format: LiquidDescriptorFormat;
	standardsUsed: string[];
};

/** The approved public wallet descriptor(s) for the connected account. */
export type LiquidGetWalletDescriptorResult = {
	accountIdentifier: string;
	chainId: string;
	descriptors: LiquidWalletDescriptorEntry[];
	policyAssetId: string;
};

/* ---------- sendTransfer ---------- */

/** A wallet-built transfer: amount + recipient for the policy asset or a supplied asset id. */
export type LiquidSendTransferParams = {
	account?: string;
	amount: string;
	assetId?: string;
	memo?: string;
	recipientAddress: string;
};

/** The broadcast transaction id of a completed transfer. */
export type LiquidSendTransferResult = {
	txid: string;
};

/* ---------- signMessage ---------- */

export const LIQUID_SIGN_MESSAGE_PROTOCOLS = {
	BIP322: "bip322",
	ECDSA: "ecdsa",
} as const;

export const LIQUID_SIGN_MESSAGE_SIGNATURE_ENCODINGS = {
	BIP322: "bip322",
	HEX_RECOVERABLE_ECDSA_65: "hex-recoverable-ecdsa-65",
} as const;

export type LiquidSignMessageProtocol =
	(typeof LIQUID_SIGN_MESSAGE_PROTOCOLS)[keyof typeof LIQUID_SIGN_MESSAGE_PROTOCOLS];

export type LiquidSignMessageSignatureEncoding =
	(typeof LIQUID_SIGN_MESSAGE_SIGNATURE_ENCODINGS)[keyof typeof LIQUID_SIGN_MESSAGE_SIGNATURE_ENCODINGS];

/** Sign an arbitrary message with the spend key of a wallet-owned address. */
export type LiquidSignMessageParams = {
	address: string;
	message: string;
	protocol?: LiquidSignMessageProtocol;
};

/** The signature plus the protocol and encoding the wallet used to produce it. */
export type LiquidSignMessageResult = {
	address: string;
	messageHash?: string;
	protocol: LiquidSignMessageProtocol;
	signature: string;
	signatureEncoding: LiquidSignMessageSignatureEncoding;
};

/* ---------- signPset ---------- */

/** One PSET input the wallet is asked to sign, identified by its address and index. */
export type LiquidSignPsetInput = {
	address: string;
	index: number;
	sighashTypes?: number[];
};

/** Sign the listed inputs of a PSET, optionally broadcasting the finalized transaction. */
export type LiquidSignPsetParams = {
	broadcast?: boolean;
	pset: string;
	signInputs: LiquidSignPsetInput[];
};

/** The signed PSET, plus a txid when it was broadcast. */
export type LiquidSignPsetResult = {
	pset: string;
	txid?: string;
};

/* ---------- identity ---------- */

export const LIQUID_IDENTITY_CURVE = "nist256p1";

export const LIQUID_IDENTITY_PUBLIC_KEY_TYPE = "slip-0013";
export const LIQUID_IDENTITY_SHARED_KEY_KDF = "hkdf-sha256";
export const LIQUID_IDENTITY_SHARED_KEY_TYPE = "slip-0017";

export type LiquidIdentityCurve = typeof LIQUID_IDENTITY_CURVE;

export type LiquidIdentityPublicKeyType = typeof LIQUID_IDENTITY_PUBLIC_KEY_TYPE;
export type LiquidIdentitySharedKeyKdf = typeof LIQUID_IDENTITY_SHARED_KEY_KDF;
export type LiquidIdentitySharedKeyType = typeof LIQUID_IDENTITY_SHARED_KEY_TYPE;

/** Derive the SLIP-0013 identity public key for an identity URI. */
export type LiquidGetIdentityPublicKeyParams = {
	curve: LiquidIdentityCurve;
	identity: string;
	index?: number;
};

export type LiquidGetIdentityPublicKeyResult = {
	curve: LiquidIdentityCurve;
	identity: string;
	index: number;
	publicKey: string;
	type: LiquidIdentityPublicKeyType;
};

/** Derive a SLIP-0017 shared key (ECDH → HKDF) against a peer's public key. */
export type LiquidGetIdentitySharedKeyParams = {
	curve: LiquidIdentityCurve;
	identity: string;
	index?: number;
	kdf: LiquidIdentitySharedKeyKdf;
	kdfInfo: string;
	kdfSalt: string;
	theirPublicKey: string;
};

export type LiquidGetIdentitySharedKeyResult = {
	curve: LiquidIdentityCurve;
	identity: string;
	index: number;
	kdf: LiquidIdentitySharedKeyKdf;
	publicKey: string;
	sharedKey: string;
	type: LiquidIdentitySharedKeyType;
};

/** Sign a hex challenge with the SLIP-0013 identity key. */
export type LiquidSignIdentityParams = {
	challenge: string;
	curve: LiquidIdentityCurve;
	identity: string;
	index?: number;
};

export type LiquidSignIdentityResult = {
	curve: LiquidIdentityCurve;
	identity: string;
	index: number;
	publicKey: string;
	signature: string;
	type: LiquidIdentityPublicKeyType;
};

/* ---------- processConfidentialTransaction ---------- */

/** Wallet ABI request. No dapp-facing shape exists yet; the wallet answers with a not-implemented error. */
export type LiquidProcessConfidentialTransactionParams = Record<string, unknown>;
