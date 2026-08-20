import type { Caip25CreateSessionResult, Caip25GetSessionResult } from "./types";

/**
 * HUMID-specific CAIP-25 `scopedProperties` key. Maps each authorized method to whether the wallet
 * runs it without a confirmation (`true`) or prompts the user on every call (`false`). Standard
 * CAIP-25 has no field for this, so it rides the sanctioned per-scope property bag under a namespaced
 * key. Kept byte-identical to the wallet's own constant so the bag round-trips. A dapp reads it to
 * auto-call only the silent methods and avoid a confirmation storm on load.
 */
export const HUMID_METHOD_POLICY_PROPERTY = "humid_methodPolicy";

/** A method→silent map: `true` runs without a prompt, `false`/absent prompts on every call. */
export type MethodPolicy = Record<string, boolean>;

/**
 * Pull the {@link HUMID_METHOD_POLICY_PROPERTY} map for one chain out of a session result's
 * `scopedProperties` bag. Returns an empty map when the wallet advertised no policy for that chain,
 * and drops any non-boolean entries so callers get a clean `Record<string, boolean>`.
 */
export function readMethodPolicy(
	result: Caip25CreateSessionResult | Caip25GetSessionResult,
	chainId: string,
): MethodPolicy {
	const raw = result.scopedProperties?.[chainId]?.[HUMID_METHOD_POLICY_PROPERTY];
	if (typeof raw !== "object" || raw === null) return {};

	const policy: MethodPolicy = {};
	for (const [method, silent] of Object.entries(raw)) {
		if (typeof silent === "boolean") policy[method] = silent;
	}

	return policy;
}
