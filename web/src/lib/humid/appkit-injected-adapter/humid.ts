import { InjectedCaipAdapter } from "./adapter";
import {
	LIQUID_DESCRIPTOR_CHANGED_EVENT,
	LIQUID_NAMESPACE,
	liquidNetworks,
	liquidWalletRpcMethods,
} from "./liquid";
import type { InjectedCaipAdapterOptions, RawInjectedProvider, SignMessageContext } from "./types";

declare global {
	interface Window {
		humid?: RawInjectedProvider;
	}
}

export const HUMID_CONNECTOR = {
	id: "humid",
	name: "HUMID Extension",
	rdns: "app.humid.extension",
};

function humidSignMessage(context: SignMessageContext): Promise<{ signature: string }> {
	return context
		.invoke<{ signature: string } | string>(context.scope, "signMessage", {
			address: context.address,
			message: context.message,
			protocol: "ecdsa",
		})
		.then((result) => ({ signature: typeof result === "string" ? result : result.signature }));
}

export type HumidAdapterOptions = Partial<InjectedCaipAdapterOptions>;

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
