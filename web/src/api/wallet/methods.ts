import type { WalletAssetBalance, WalletCapabilities, WalletUtxo } from '@/lib/wallet/types'

/**
 * What the wallet says the account holds of each named asset, in base units.
 *
 * Asked asset by asset because that is the question the wallet answers; the assets this dapp
 * shows are a fixed short list, so the round trips are counted rather than unbounded. An asset
 * the wallet reports nothing for is absent from the result rather than present as zero.
 */
export async function fetchWalletBalances(
  capabilities: WalletCapabilities,
  assetIds: readonly string[],
): Promise<Record<string, WalletAssetBalance>> {
  const amounts = await Promise.all(assetIds.map(assetId => capabilities.getBalance(assetId)))

  return Object.fromEntries(assetIds.map((assetId, index) => [assetId, amounts[index]!]))
}

/** The outputs the wallet will spend for one asset. */
export function fetchWalletUtxos(
  capabilities: WalletCapabilities,
  assetId: string,
): Promise<WalletUtxo[]> {
  return capabilities.getUtxos(assetId)
}
