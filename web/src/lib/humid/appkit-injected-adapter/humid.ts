import { InjectedCaipAdapter } from "./adapter";
import {
	LIQUID_DESCRIPTOR_CHANGED_EVENT,
	LIQUID_NAMESPACE,
	liquidNetworks,
	liquidWalletRpcMethods,
} from "./liquid";
import type { InjectedCaipAdapterOptions, RawInjectedProvider, SignMessageContext } from "./types";

// The HUMID browser extension injects its CAIP-25 / CAIP-27 provider on this global. Declared here in
// the HUMID preset (not the agnostic core), and picked up by any consumer that imports the package.
declare global {
	interface Window {
		humid?: RawInjectedProvider;
	}
}

/** The injected connector identity HUMID advertises in the AppKit connect modal. */
export const HUMID_CONNECTOR = {
	id: "humid",
	name: "HUMID Extension",
	rdns: "app.humid.extension",
};

/** HUMID's signMessage takes an explicit signing protocol (ecdsa), unlike the bare default. */
function humidSignMessage(context: SignMessageContext): Promise<{ signature: string }> {
	return context
		.invoke<{ signature: string } | string>(context.scope, "signMessage", {
			address: context.address,
			message: context.message,
			protocol: "ecdsa",
		})
		.then((result) => ({ signature: typeof result === "string" ? result : result.signature }));
}

/** Overridable HUMID defaults — every field is preset, so `{}` (or nothing) is the common case. */
export type HumidAdapterOptions = Partial<InjectedCaipAdapterOptions>;

/**
 * The HUMID injected-wallet adapter with every option preset: `new HumidAdapter()` is all a dapp
 * needs to connect (pair it with the exported `liquidNetworks`). Pass overrides to change any default
 * — a different injected global, method set, namespace, etc.
 */
export class HumidAdapter extends InjectedCaipAdapter {
	constructor(overrides: HumidAdapterOptions = {}) {
		super({
			namespace: LIQUID_NAMESPACE,
			connector: HUMID_CONNECTOR,
			getProvider: () => window.humid,
			methods: liquidWalletRpcMethods,
			notifications: [LIQUID_DESCRIPTOR_CHANGED_EVENT],
			networks: liquidNetworks,
			signMessage: humidSignMessage,
			...overrides,
		});
	}
}
