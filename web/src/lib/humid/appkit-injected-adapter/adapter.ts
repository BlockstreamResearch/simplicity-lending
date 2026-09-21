import type { CaipAddress, CaipNetwork, ChainNamespace, Hex } from "@reown/appkit-common";
import {
	AdapterBlueprint,
	CoreHelperUtil,
	WalletConnectConnector,
	type ChainAdapterConnector,
} from "@reown/appkit-controllers";
import type UniversalProvider from "@walletconnect/universal-provider";

import { createInjectedProvider, waitForProvider } from "./provider";
import {
	addChain as addChainRpc,
	type AddChainParams,
	createSession,
	getSession,
	invokeMethod,
	revokeSession,
	switchChain as switchChainRpc,
} from "./rpc";
import type {
	Caip25Scopes,
	InjectedCaipAdapterOptions,
	InjectedProvider,
	RawInjectedProvider,
} from "./types";

const DEFAULT_ACCOUNT_TYPE = "payment";

const WALLET_BRIDGE_EVENTS = [
	"accountsChanged",
	"chainChanged",
	"wallet_sessionChanged",
	"disconnect",
] as const;

export class InjectedCaipAdapter extends AdapterBlueprint<ChainAdapterConnector> {
	private readonly options: InjectedCaipAdapterOptions;
	private readonly injectedProvider: InjectedProvider;

	private walletEventUnsubscribers: Array<() => void> = [];
	private lastEmittedAddress: string | undefined;
	private lastEmittedChainId: string | undefined;

	constructor(options: InjectedCaipAdapterOptions) {
		super({ namespace: options.namespace as ChainNamespace });

		this.options = options;
		this.injectedProvider = createInjectedProvider(options.getProvider, {
			connectorId: options.connector.id,
			timeoutMs: options.providerTimeoutMs,
		});
	}

	async setUniversalProvider(universalProvider: UniversalProvider) {
		if (!this.namespace) {
			throw new Error("InjectedCaipAdapter:setUniversalProvider - namespace is required");
		}

		this.addConnector(
			new WalletConnectConnector({
				provider: universalProvider,
				caipNetworks: this.getCaipNetworks(this.namespace),
				namespace: this.namespace,
			}),
		);
	}

	async connect(params: AdapterBlueprint.ConnectParams) {
		if (params.id !== this.options.connector.id) {
			throw new Error(`Unsupported connector: ${params.id}`);
		}

		const network = this.resolveNetwork(params.chainId);

		const { sessionScopes } = await createSession(this.injectedProvider, this.buildSessionScopes());
		const accountIdentifier = sessionScopes[network.caipNetworkId]?.accounts?.[0];

		if (!accountIdentifier) {
			throw new Error(`${this.options.connector.name} returned no account for this chain.`);
		}

		const account = parseCaipAccountId(accountIdentifier);

		this.onConnect(
			[
				{
					address: account.address,
					chainId: network.id,
					chainNamespace: this.options.namespace as ChainNamespace,
				},
			],
			this.options.connector.id,
		);

		await this.subscribeToWalletEvents({ address: account.address, chainId: network.id });

		return {
			id: this.options.connector.id,
			type: "INJECTED" as const,
			provider: this.injectedProvider,
			chainId: network.id,
			address: account.address,
			accounts: [] as [],
		};
	}

	async disconnect(params?: AdapterBlueprint.DisconnectParams) {
		if (!params?.id || params.id === this.options.connector.id) {
			try {
				await revokeSession(this.injectedProvider);
			} catch {}

			this.onDisconnect(this.options.connector.id);
			this.unsubscribeFromWalletEvents();
			this.lastEmittedAddress = undefined;
			this.lastEmittedChainId = undefined;
		}

		return { connections: this.connections };
	}

	async getAccounts() {
		return {
			accounts: this.connections.flatMap((connection) =>
				connection.accounts.map((account) => {
					const caipAddress =
						account.caipAddress ?? toCaipAddress(connection.caipNetwork, account.address);

					return CoreHelperUtil.createAccount<ChainNamespace>({
						caipAddress,
						type: this.options.accountType ?? DEFAULT_ACCOUNT_TYPE,
						publicKey: account.publicKey,
					});
				}),
			),
		};
	}

	async getBalance(params: AdapterBlueprint.GetBalanceParams) {
		return {
			balance: "0.00",
			symbol: params.caipNetwork?.nativeCurrency.symbol ?? "",
		};
	}

	async syncConnectors() {
		this.addConnector({
			id: this.options.connector.id,
			type: "INJECTED",
			name: this.options.connector.name,
			provider: this.injectedProvider,
			chain: this.options.namespace as ChainNamespace,
			chains: this.getCaipNetworks(this.namespace),
			info: {
				name: this.options.connector.name,
				rdns: this.options.connector.rdns,
				uuid: this.options.connector.id,
			},
		});
	}

	syncConnections() {
		return Promise.resolve();
	}

	async syncConnection(params: AdapterBlueprint.SyncConnectionParams) {
		const network = this.resolveNetwork(params.chainId);

		const { sessionScopes } = await getSession(this.injectedProvider);
		const accountIdentifier = sessionScopes[network.caipNetworkId]?.accounts?.[0];

		if (!accountIdentifier) {
			throw new Error("No existing session to restore.");
		}

		const account = parseCaipAccountId(accountIdentifier);

		this.onConnect(
			[
				{
					address: account.address,
					chainId: network.id,
					chainNamespace: this.options.namespace as ChainNamespace,
				},
			],
			this.options.connector.id,
		);

		await this.subscribeToWalletEvents({ address: account.address, chainId: network.id });

		return {
			id: this.options.connector.id,
			type: "INJECTED" as const,
			provider: this.injectedProvider,
			chainId: network.id,
			address: account.address,
			accounts: [] as [],
		};
	}

	async signMessage(params: AdapterBlueprint.SignMessageParams) {
		const caipNetwork = this.getConnection({
			connectors: this.connectors,
			connections: this.connections,
			connectorId: this.options.connector.id,
		})?.caipNetwork;

		if (!caipNetwork) throw new Error(`${this.options.connector.name} connection is missing`);

		const scope = caipNetwork.caipNetworkId;
		const invoke = <T>(target: string, method: string, methodParams?: unknown): Promise<T> =>
			invokeMethod<T>(this.injectedProvider, target, method, methodParams);

		if (this.options.signMessage) {
			return this.options.signMessage({
				scope,
				address: params.address,
				message: params.message,
				invoke,
			});
		}

		const result = await invoke<{ signature: string } | string>(scope, "signMessage", {
			address: params.address,
			message: params.message,
		});

		return { signature: typeof result === "string" ? result : result.signature };
	}

	async estimateGas() {
		return { gas: 0n };
	}

	async sendTransaction() {
		return { hash: "" };
	}

	async writeContract() {
		return { hash: "" };
	}

	async writeSolanaTransaction() {
		return { hash: "" };
	}

	parseUnits(params: AdapterBlueprint.ParseUnitsParams) {
		return BigInt(params.value);
	}

	formatUnits(params: AdapterBlueprint.FormatUnitsParams) {
		return params.value.toString();
	}

	getWalletConnectProvider(params: AdapterBlueprint.GetWalletConnectProviderParams) {
		return params.provider;
	}

	async getCapabilities() {
		return {
			methods: [...this.options.methods],
		};
	}

	async addChain(params: AddChainParams): Promise<{ chainId: string }> {
		return addChainRpc(this.injectedProvider, params);
	}

	async switchChain(chainId: string): Promise<{ chainId: string }> {
		return switchChainRpc(this.injectedProvider, chainId);
	}

	async grantPermissions() {
		return {};
	}

	async revokePermissions(): Promise<Hex> {
		return "0x";
	}

	async walletGetAssets() {
		return {};
	}

	private async subscribeToWalletEvents(seed?: { address: string; chainId: string | number }) {
		if (seed) {
			this.lastEmittedAddress = seed.address;
			this.lastEmittedChainId = seed.chainId.toString();
		}

		this.unsubscribeFromWalletEvents();

		let raw: RawInjectedProvider;
		try {
			raw = await waitForProvider(this.options.getProvider, this.options.providerTimeoutMs);
		} catch {
			return; // Provider not on the page; nothing to bridge (a later connect re-subscribes).
		}

		const subscribe = raw.on;
		if (!subscribe) return; // Wallet exposes no event channel.

		for (const eventName of WALLET_BRIDGE_EVENTS) {
			const unsubscribe = subscribe({
				event: eventName,
				listener: (payload) => {
					void this.handleWalletEvent(payload);
				},
			});

			if (unsubscribe) this.walletEventUnsubscribers.push(unsubscribe);
		}
	}

	private unsubscribeFromWalletEvents() {
		for (const unsubscribe of this.walletEventUnsubscribers) {
			try {
				unsubscribe();
			} catch {}
		}

		this.walletEventUnsubscribers = [];
	}

	private async handleWalletEvent(payload: unknown) {
		let sessionScopes: Caip25Scopes;
		try {
			({ sessionScopes } = await getSession(this.injectedProvider));
		} catch {
			return; // Transient read failure: keep the current view rather than flapping.
		}

		const network = this.resolveNetworkForEvent(payload);
		const accountIdentifier = sessionScopes[network.caipNetworkId]?.accounts?.[0];

		if (!accountIdentifier) {
			if (this.lastEmittedAddress !== undefined) {
				this.lastEmittedAddress = undefined;
				this.lastEmittedChainId = undefined;
				this.onDisconnect(this.options.connector.id);
			}

			return;
		}

		const { address } = parseCaipAccountId(accountIdentifier);
		const nextChainId = network.id.toString();
		const chainChanged =
			this.lastEmittedChainId !== undefined && nextChainId !== this.lastEmittedChainId;
		const accountChanged = address !== this.lastEmittedAddress;

		if (!chainChanged && !accountChanged) return; // Nothing AppKit doesn't already know.

		this.lastEmittedAddress = address;
		this.lastEmittedChainId = nextChainId;

		if (chainChanged) {
			this.emit("switchNetwork", { chainId: network.id });
		}

		this.onConnect(
			[
				{
					address,
					chainId: network.id,
					chainNamespace: this.options.namespace as ChainNamespace,
				},
			],
			this.options.connector.id,
		);
	}

	private resolveNetworkForEvent(payload: unknown): CaipNetwork {
		const eventChainId = extractEventChainId(payload);

		if (eventChainId) {
			const reference = eventChainId.includes(":")
				? eventChainId.slice(eventChainId.lastIndexOf(":") + 1)
				: eventChainId;
			const match = this.resolveNetworks().find(
				(network) =>
					network.caipNetworkId === eventChainId ||
					network.id.toString() === eventChainId ||
					network.id.toString() === reference,
			);

			if (match) return match;
		}

		const activeNetwork = this.getConnection({
			connectors: this.connectors,
			connections: this.connections,
			connectorId: this.options.connector.id,
		})?.caipNetwork;

		return activeNetwork ?? this.resolveNetwork(this.lastEmittedChainId);
	}

	private buildSessionScopes(): Caip25Scopes {
		const notifications = [...(this.options.notifications ?? [])];

		return Object.fromEntries(
			this.resolveNetworks().map((network) => [
				network.caipNetworkId,
				{
					methods: [...this.options.methods],
					notifications,
				},
			]),
		);
	}

	private resolveNetworks(): readonly CaipNetwork[] {
		return this.options.networks ?? this.getCaipNetworks(this.namespace);
	}

	private resolveNetwork(chainId: number | string | undefined): CaipNetwork {
		const networks = this.resolveNetworks();
		const network =
			networks.find((item) => item.id.toString() === chainId?.toString()) ?? networks[0];

		if (!network) throw new Error(`No ${this.options.namespace} network configured`);

		return network;
	}
}

function extractEventChainId(payload: unknown): string | undefined {
	if (typeof payload === "string") return payload;

	if (payload && typeof payload === "object" && "chainId" in payload) {
		const { chainId } = payload as { chainId?: unknown };
		if (typeof chainId === "string") return chainId;
		if (typeof chainId === "number") return chainId.toString();
	}

	return undefined;
}

function parseCaipAccountId(accountIdentifier: string): { address: string; scope: string } {
	const separator = accountIdentifier.lastIndexOf(":");

	if (separator <= 0) {
		throw new Error(`Invalid CAIP account identifier: ${accountIdentifier}`);
	}

	return {
		address: accountIdentifier.slice(separator + 1),
		scope: accountIdentifier.slice(0, separator),
	};
}

function toCaipAddress(network: CaipNetwork | undefined, address: string): CaipAddress {
	if (!network) throw new Error("Cannot build CAIP address without network");

	return `${network.caipNetworkId}:${address}` as CaipAddress;
}
