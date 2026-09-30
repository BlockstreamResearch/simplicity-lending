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

export type InjectedRequestArguments = Omit<RequestArguments, "params"> & {
	chainId?: string;
	params?: unknown;
};

export type InjectedProvider = Omit<Provider, "request"> & {
	request: <T>(args: InjectedRequestArguments) => Promise<T>;
};

export type CaipRpcProvider = {
	request: <T>(args: { method: string; params?: unknown }) => Promise<T>;
};

export type Caip25ScopeObject = {
	accounts?: string[];
	methods: string[];
	notifications: string[];
};

export type Caip25Scopes = Record<string, Caip25ScopeObject>;

export type Caip25ScopedProperties = Record<string, Record<string, unknown>>;

export type Caip25CreateSessionResult = {
	scopedProperties?: Caip25ScopedProperties;
	sessionProperties?: Record<string, unknown>;
	sessionScopes: Caip25Scopes;
};

export type Caip25GetSessionResult = {
	scopedProperties?: Caip25ScopedProperties;
	sessionScopes: Caip25Scopes;
};

export type SignMessageContext = {
	scope: string;
	address: string;
	message: string;
	invoke: <T>(scope: string, method: string, params?: unknown) => Promise<T>;
};

export type InjectedCaipAdapterOptions = {
	namespace: string;
	connector: {
		id: string;
		name: string;
		rdns: string;
	};
	getProvider: () => RawInjectedProvider | undefined;
	methods: readonly string[];
	notifications?: readonly string[];
	networks?: readonly CaipNetwork[];
	accountType?: string;
	signMessage?: (context: SignMessageContext) => Promise<{ signature: string }>;
	providerTimeoutMs?: number;
};
