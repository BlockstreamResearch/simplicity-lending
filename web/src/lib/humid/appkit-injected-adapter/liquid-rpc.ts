export type LiquidGetBalanceParams = {
	assetId?: string;
};

export type LiquidGetBalanceResult = {
	accountIdentifier: string;
	assetId: string;
	balance: string;
	chainId: string;
	policyAssetId: string;
};

export type LiquidGetUTXOsParams = {
	assetId?: string;
};

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

export type LiquidGetUTXOsResult = {
	accountIdentifier: string;
	assetId: string;
	chainId: string;
	policyAssetId: string;
	utxos: LiquidUTXO[];
};

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

export type LiquidDescriptorBranch = {
	addressIndex: "*";
	branch: "external" | "internal";
	change: 0 | 1;
};

export type LiquidDescriptorBranchDescriptor = {
	branch: "external" | "internal";
	change: 0 | 1;
	descriptor: string;
};

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

export type LiquidGetWalletDescriptorResult = {
	accountIdentifier: string;
	chainId: string;
	descriptors: LiquidWalletDescriptorEntry[];
	policyAssetId: string;
};

export type LiquidSendTransferParams = {
	account?: string;
	amount: string;
	assetId?: string;
	memo?: string;
	recipientAddress: string;
};

export type LiquidSendTransferResult = {
	txid: string;
};

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

export type LiquidSignMessageParams = {
	address: string;
	message: string;
	protocol?: LiquidSignMessageProtocol;
};

export type LiquidSignMessageResult = {
	address: string;
	messageHash?: string;
	protocol: LiquidSignMessageProtocol;
	signature: string;
	signatureEncoding: LiquidSignMessageSignatureEncoding;
};

export type LiquidSignPsetInput = {
	address: string;
	index: number;
	sighashTypes?: number[];
};

export type LiquidSignPsetParams = {
	broadcast?: boolean;
	pset: string;
	signInputs: LiquidSignPsetInput[];
};

export type LiquidSignPsetResult = {
	pset: string;
	txid?: string;
};

export const LIQUID_IDENTITY_CURVE = "nist256p1";

export const LIQUID_IDENTITY_PUBLIC_KEY_TYPE = "slip-0013";
export const LIQUID_IDENTITY_SHARED_KEY_KDF = "hkdf-sha256";
export const LIQUID_IDENTITY_SHARED_KEY_TYPE = "slip-0017";

export type LiquidIdentityCurve = typeof LIQUID_IDENTITY_CURVE;

export type LiquidIdentityPublicKeyType = typeof LIQUID_IDENTITY_PUBLIC_KEY_TYPE;
export type LiquidIdentitySharedKeyKdf = typeof LIQUID_IDENTITY_SHARED_KEY_KDF;
export type LiquidIdentitySharedKeyType = typeof LIQUID_IDENTITY_SHARED_KEY_TYPE;

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

export type LiquidProcessConfidentialTransactionParams = Record<string, unknown>;

export type LiquidProcessConfidentialTransactionResult = {
	broadcast: boolean;
	deployment?: Record<string, string>;
	feeSats: string;
	transactionHex: string;
	txid: string;
};
