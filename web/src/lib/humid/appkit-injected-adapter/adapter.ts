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

/** window.<wallet> events that should re-sync this origin's AppKit account / network view. */
const WALLET_BRIDGE_EVENTS = [
	"accountsChanged",
	"chainChanged",
	"wallet_sessionChanged",
	"disconnect",
] as const;

/**
 * An AppKit AdapterBlueprint for an injected wallet that authorizes via CAIP-25 and invokes methods
 * via CAIP-27. Everything wallet / chain / brand-specific is supplied through
 * {@link InjectedCaipAdapterOptions}, so the same class serves any such wallet.
 */
export class InjectedCaipAdapter extends AdapterBlueprint<ChainAdapterConnector> {
	private readonly options: InjectedCaipAdapterOptions;
	private readonly injectedProvider: InjectedProvider;

	/** off-handles for the window.<wallet> subscriptions this adapter bridges into AppKit. */
	private walletEventUnsubscribers: Array<() => void> = [];
	/** Last account/chain this adapter told AppKit about — used to suppress duplicate emits. */
	private lastEmittedAddress: string | undefined;
	private lastEmittedChainId: string | undefined;

	constructor(options: InjectedCaipAdapterOptions) {
		// AppKit matches a passed adapter to a chain namespace by `adapter.namespace` (see
		// createAdapters) BEFORE calling construct(). Without it, the namespace slot falls back to a
		// WalletConnect-only UniversalAdapter and this adapter's syncConnectors never runs — so the
		// injected connector never shows in the connect modal. Set the namespace up front.
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

		// Opens the wallet's connect approval modal; the result advertises the granted account ids per
		// chain, so no follow-up read is needed.
		const { sessionScopes } = await createSession(this.injectedProvider, this.buildSessionScopes());
		const accountIdentifier = sessionScopes[network.caipNetworkId]?.accounts?.[0];

		if (!accountIdentifier) {
			throw new Error(`${this.options.connector.name} returned no account for this chain.`);
		}

		const account = parseCaipAccountId(accountIdentifier);

		// Hand AppKit a ParsedCaipAddress OBJECT (not a string): getAccount keeps the chainId, so
		// setCaipAddress gets a valid `<namespace>:<ref>:<address>`. `network.id` is the bare chain ref.
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

		// From here on, bridge wallet-side account/chain/session changes into AppKit. Seed the
		// last-emitted snapshot with what we just connected so only a real change triggers the next emit.
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
			} catch {
				// Best-effort: clear local connection state even if the wallet is unreachable.
			}

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

		// Restore ONLY from an existing session (read-only getSession, no approval prompt). Throwing
		// when there's nothing to restore makes AppKit clear the connector id it restored from storage;
		// otherwise a later manual connect can't change activeConnectorIds and the modal hangs.
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

		// Restored a live session — start bridging wallet-side changes, seeded with the restored account.
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

	/**
	 * Propose a new chain to the wallet (wallet_addChain). The wallet gates it behind a user approval
	 * and mints its OWN id, returning it — pass that id to {@link switchChain} to use the new chain.
	 * Not part of AppKit's AdapterBlueprint; exposed for dapps that manage chains directly.
	 */
	async addChain(params: AddChainParams): Promise<{ chainId: string }> {
		return addChainRpc(this.injectedProvider, params);
	}

	/**
	 * Ask the wallet to grant THIS connection a chain it already knows (wallet_switchChain, user-
	 * approved per-connection scope expansion). Rejects with the wallet's unrecognized-chain error
	 * (EVM 4902) when the chain is unknown — call {@link addChain} first in that case.
	 */
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

	/**
	 * Bridge the injected wallet's own events into AppKit. AppKit's base only re-emits `accountChanged`
	 * / `switchNetwork` for the EVM namespace (see AdapterBlueprint.onAccountsChanged / onChainChanged),
	 * so for this (bip122) adapter we subscribe to `window.<wallet>` directly and emit the adapter events
	 * ourselves. Each relevant event re-reads THIS origin's session (read-only, no prompt) and reconciles
	 * account + chain against the last thing we told AppKit. Seed avoids a duplicate emit right after
	 * connect/restore.
	 */
	private async subscribeToWalletEvents(seed?: { address: string; chainId: string | number }) {
		if (seed) {
			this.lastEmittedAddress = seed.address;
			this.lastEmittedChainId = seed.chainId.toString();
		}

		// Never stack handlers across reconnects: drop any previous subscription first.
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

	/** Drop every window.<wallet> subscription this adapter registered. */
	private unsubscribeFromWalletEvents() {
		for (const unsubscribe of this.walletEventUnsubscribers) {
			try {
				unsubscribe();
			} catch {
				// Best-effort: a wallet that already tore down its channel is fine to ignore.
			}
		}

		this.walletEventUnsubscribers = [];
	}

	/**
	 * React to one wallet event. The broadcast payload is only a trigger — CAIP-25 accounts are
	 * per-origin, so we re-read `wallet_getSession` for THIS origin and emit the AppKit adapter events
	 * that move `useAppKitAccount` / `useAppKitNetwork`.
	 */
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
			// This origin has no account on the active chain anymore (session revoked / wallet locked):
			// mirror disconnect()'s onDisconnect so AppKit clears the connection. Guarded to fire once.
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

		// bip122 is EVM-gated out of the base's onChainChanged, so emit `switchNetwork` ourselves; the
		// base subscriber matches the network by `network.id` and re-syncs `useAppKitNetwork` under it.
		if (chainChanged) {
			this.emit("switchNetwork", { chainId: network.id });
		}

		// Reuse onConnect with the exact ParsedCaipAddress object shape connect() uses: it emits the
		// (ungated) `accountChanged` AND refreshes the stored connection's account + caipNetwork.
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

	/**
	 * The network an event refers to: the event's own chainId when it carries one (chainChanged), else
	 * the active connection's network, else the configured default. Accepts a CAIP-2 id or a bare ref.
	 */
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

	/**
	 * The networks this adapter serves. Prefer the explicitly-configured `options.networks` so the
	 * adapter never depends on AppKit having them registered in its ChainController — that registration
	 * can be empty for a custom namespace at connect time (namespace derivation, approved-network
	 * filtering, reconnect state). Falls back to AppKit's networks when no list is configured.
	 */
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

/** Pull a chain id out of a wallet event payload (`{ chainId }` or a bare string), if present. */
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
