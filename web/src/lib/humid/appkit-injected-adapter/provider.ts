import type { InjectedProvider, InjectedRequestArguments, RawInjectedProvider } from "./types";

const DEFAULT_PROVIDER_TIMEOUT_MS = 3000;

type CreateInjectedProviderOptions = {
	/** Value returned from the bridged provider's `connect()` (AppKit's injected connector id). */
	connectorId: string;
	/** Max wait (ms) for the injected provider to appear before a request rejects. */
	timeoutMs?: number;
};

/**
 * Wrap the raw injected provider in an AppKit-compatible provider with a small event fan-out. The
 * raw global is resolved lazily per request via `getProvider`, so a fresh page load — where the
 * wallet injects a tick late — still works, most importantly AppKit's restore-on-load.
 */
export function createInjectedProvider(
	getProvider: () => RawInjectedProvider | undefined,
	{ connectorId, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS }: CreateInjectedProviderOptions,
): InjectedProvider {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const rawUnsubscribers = new Map<string, () => void>();

	const emit = (event: string, payload?: unknown) => {
		listeners.get(event)?.forEach((listener) => listener(payload));
	};

	const provider: InjectedProvider = {
		connect: async () => connectorId,
		disconnect: async () => {
			emit("disconnect");
		},
		request: async <T>(args: InjectedRequestArguments) => {
			const raw = await waitForProvider(getProvider, timeoutMs);

			return raw.request<T>(args);
		},
		on: (event, listener) => {
			const eventListeners = listeners.get(event) ?? new Set();
			eventListeners.add(listener as (payload: unknown) => void);
			listeners.set(event, eventListeners);

			if (!rawUnsubscribers.has(event)) {
				const rawUnsubscribe = getProvider()?.on?.({
					event,
					listener: (payload) => emit(event, payload),
				});

				if (rawUnsubscribe) rawUnsubscribers.set(event, rawUnsubscribe);
			}
		},
		removeListener: (event, listener) => {
			const eventListeners = listeners.get(event);
			eventListeners?.delete(listener as (payload: unknown) => void);

			if (eventListeners?.size === 0) {
				listeners.delete(event);
				rawUnsubscribers.get(event)?.();
				rawUnsubscribers.delete(event);
			}
		},
		emit,
	};

	return provider;
}

/**
 * Resolve the raw injected provider, waiting briefly if it isn't on the page yet. A content script
 * usually injects it asynchronously, so on a fresh load the adapter (especially AppKit's
 * restore-on-load, which calls syncConnection early) can run before it exists — wait instead of
 * failing immediately, so an existing session actually restores rather than being dropped.
 */
export function waitForProvider(
	getProvider: () => RawInjectedProvider | undefined,
	timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<RawInjectedProvider> {
	const existing = getProvider();

	if (existing) return Promise.resolve(existing);

	const start = Date.now();

	return new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			const found = getProvider();

			if (found) {
				clearInterval(timer);
				resolve(found);
			} else if (Date.now() - start >= timeoutMs) {
				clearInterval(timer);
				reject(new Error("Injected wallet provider was not found on the page."));
			}
		}, 50);
	});
}
