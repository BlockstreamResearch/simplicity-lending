import { defineChain } from "@reown/appkit/networks";

export const LIQUID_NAMESPACE = "bip122";

export const LIQUID_MAINNET_CHAIN_REFERENCE = "1466275836220db2944ca059a3a10ef6";
export const LIQUID_TESTNET_CHAIN_REFERENCE = "a771da8e52ee6ad581ed1e9a99825e5b";

export const LIQUID_MAINNET_CHAIN_ID =
	`${LIQUID_NAMESPACE}:${LIQUID_MAINNET_CHAIN_REFERENCE}` as const;
export const LIQUID_TESTNET_CHAIN_ID =
	`${LIQUID_NAMESPACE}:${LIQUID_TESTNET_CHAIN_REFERENCE}` as const;

export const LIQUID_DESCRIPTOR_CHANGED_EVENT = "bip122_walletDescriptorChanged";

export const liquidWalletRpcMethods = [
	"getBalance",
	"getUTXOs",
	"getWalletDescriptor",
	"getIdentityPublicKey",
	"getIdentitySharedKey",
	"processConfidentialTransaction",
	"sendTransfer",
	"signIdentity",
	"signMessage",
	"signPset",
] as const;

export const liquid = defineChain({
	id: LIQUID_MAINNET_CHAIN_REFERENCE,
	caipNetworkId: LIQUID_MAINNET_CHAIN_ID,
	chainNamespace: LIQUID_NAMESPACE,
	name: "Liquid",
	nativeCurrency: { name: "Liquid Bitcoin", symbol: "L-BTC", decimals: 8 },
	rpcUrls: { default: { http: ["https://blockstream.info/liquid/api"] } },
});

export const liquidTestnet = defineChain({
	id: LIQUID_TESTNET_CHAIN_REFERENCE,
	caipNetworkId: LIQUID_TESTNET_CHAIN_ID,
	chainNamespace: LIQUID_NAMESPACE,
	name: "Liquid Testnet",
	nativeCurrency: { name: "Testnet Liquid Bitcoin", symbol: "tL-BTC", decimals: 8 },
	rpcUrls: { default: { http: ["https://blockstream.info/liquidtestnet/api"] } },
	testnet: true,
});

export const liquidNetworks = [liquid, liquidTestnet] as [typeof liquid, typeof liquidTestnet];
