import { defineChain } from "@reown/appkit/networks";

// Liquid chain / ELIP-1 definitions. Static (a genesis hash never changes), so they live in the
// package and are re-exported for dapps instead of being hand-rolled per consumer.

/** CAIP-2 namespace for Liquid — shared with Bitcoin (bip122). */
export const LIQUID_NAMESPACE = "bip122";

/** CAIP-2 chain references (genesis block hashes) for the Liquid networks. */
export const LIQUID_MAINNET_CHAIN_REFERENCE = "1466275836220db2944ca059a3a10ef6";
export const LIQUID_TESTNET_CHAIN_REFERENCE = "a771da8e52ee6ad581ed1e9a99825e5b";

export const LIQUID_MAINNET_CHAIN_ID =
	`${LIQUID_NAMESPACE}:${LIQUID_MAINNET_CHAIN_REFERENCE}` as const;
export const LIQUID_TESTNET_CHAIN_ID =
	`${LIQUID_NAMESPACE}:${LIQUID_TESTNET_CHAIN_REFERENCE}` as const;

/** ELIP-1 notification the wallet emits when its descriptor / account / policy asset changes. */
export const LIQUID_DESCRIPTOR_CHANGED_EVENT = "bip122_walletDescriptorChanged";

/** The ELIP-1 Liquid Wallet RPC method surface a dapp can request. */
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

// Defined with AppKit's own `defineChain` so they drop straight into `createAppKit({ networks })`,
// exactly like the built-in `bitcoin` / `bitcoinTestnet` networks.
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

/**
 * Both Liquid networks as a fixed-length tuple, ready for `createAppKit({ networks })`. The concrete
 * element types are kept (not widened to `AppKitNetwork`) so consumers still see `caipNetworkId` etc.
 */
export const liquidNetworks = [liquid, liquidTestnet] as [typeof liquid, typeof liquidTestnet];
