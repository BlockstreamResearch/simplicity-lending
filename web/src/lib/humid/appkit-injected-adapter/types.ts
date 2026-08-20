import type { CaipNetwork } from "@reown/appkit-common";
import type { Provider, RequestArguments } from "@reown/appkit-controllers";

/**
 * The minimal surface an injected wallet must expose on the page. `request` speaks the CAIP-25 /
 * CAIP-27 envelope; `on` is the optional EIP-1193-style event channel. Both the raw injected global
 * (e.g. `window.<wallet>`) and this package's bridged provider satisfy it.
 */
export type RawInjectedProvider = {
	request: <T>(args: InjectedRequestArguments) => Promise<T>;
	on?: (args: { event: string; listener: (payload: unknown) => void }) => () => void;
};

/** AppKit request args, widened to carry an optional chainId + arbitrary params. */
export type InjectedRequestArguments = Omit<RequestArguments, "params"> & {
	chainId?: string;
	params?: unknown;
};

/** AppKit `Provider` with the widened `request` signature this adapter uses. */
export type InjectedProvider = Omit<Provider, "request"> & {
	request: <T>(args: InjectedRequestArguments) => Promise<T>;
};

/** Minimal provider surface the RPC helpers need: a single `request`. */
export type CaipRpcProvider = {
	request: <T>(args: { method: string; params?: unknown }) => Promise<T>;
};

/** A single CAIP-25 scope: granted accounts (CAIP-10 ids), methods, and notifications. */
export type Caip25ScopeObject = {
	accounts?: string[];
	methods: string[];
	notifications: string[];
};

/** CAIP-25 scopes keyed by CAIP-2 chain id. */
export type Caip25Scopes = Record<string, Caip25ScopeObject>;

/**
 * Per-scope free-form metadata (CAIP-25 `scopedProperties`), keyed by CAIP-2 chain id. The sanctioned
 * place for data the fixed scope object can't carry; HUMID rides {@link HUMID_METHOD_POLICY_PROPERTY}
 * in here (see `./policy`).
 */
export type Caip25ScopedProperties = Record<string, Record<string, unknown>>;

export type Caip25CreateSessionResult = {
	scopedProperties?: Caip25ScopedProperties;
	sessionProperties?: Record<string, unknown>;
	sessionScopes: Caip25Scopes;
};

/** Result of `wallet_getSession`: the current scopes plus the wallet's per-scope properties. */
export type Caip25GetSessionResult = {
	scopedProperties?: Caip25ScopedProperties;
	sessionScopes: Caip25Scopes;
};

/** Context handed to a custom `signMessage` implementation. */
export type SignMessageContext = {
	/** CAIP-2 chain id (caipNetworkId) of the active connection. */
	scope: string;
	address: string;
	message: string;
	/** Invoke a wallet RPC method (CAIP-27) within the active session. */
	invoke: <T>(scope: string, method: string, params?: unknown) => Promise<T>;
};

/**
 * Everything the adapter needs to serve a specific injected wallet, kept free of any brand, chain,
 * or domain assumptions — supply these and the same adapter works for any CAIP-25/27 injected wallet.
 */
export type InjectedCaipAdapterOptions = {
	/** CAIP-2 namespace this adapter serves (e.g. "bip122", "eip155", "solana"). */
	namespace: string;
	/** Injected connector identity shown in the AppKit connect modal. */
	connector: {
		id: string;
		name: string;
		rdns: string;
	};
	/** Locate the raw injected provider on the page (e.g. `() => window.myWallet`). */
	getProvider: () => RawInjectedProvider | undefined;
	/** RPC methods requested in each session scope and advertised as capabilities. */
	methods: readonly string[];
	/** CAIP-25 notifications requested in each session scope. */
	notifications?: readonly string[];
	/**
	 * The networks this adapter serves. When set, the adapter uses these directly instead of reading
	 * AppKit's ChainController — whose per-namespace network registration can be empty for a custom
	 * namespace at connect time. Falls back to AppKit's registered networks when omitted.
	 */
	networks?: readonly CaipNetwork[];
	/**
	 * Account type tag applied to accounts this wallet exposes (AppKit's per-namespace account model —
	 * e.g. "payment" for bip122, "eoa" for eip155). Default "payment".
	 */
	accountType?: string;
	/**
	 * Maps AppKit's signMessage to a wallet RPC call. Defaults to invoking a "signMessage" method
	 * with `{ address, message }`. Override to add protocol/curve params or a different method name.
	 */
	signMessage?: (context: SignMessageContext) => Promise<{ signature: string }>;
	/** How long to wait (ms) for the injected provider to appear before failing. Default 3000. */
	providerTimeoutMs?: number;
};
