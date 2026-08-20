import { WALLET_CHAIN_ID } from '@/lib/wallet/network'

/**
 * The asset id the wallet accepts, built from the bare identifier this dapp carries.
 *
 * The wallet names an asset by the chain it lives on as well as by its own identifier —
 * `<chain>/elip144:<asset>` — and validates that shape before it does anything else, refusing
 * both a bare identifier and one belonging to another chain. Everything above this file names
 * an asset by its identifier alone, because that is what the protocol document, the indexer and
 * the screens all use, so the translation belongs here at the boundary that speaks to the wallet
 * rather than in a constant somewhere that would have to be kept in step with the network.
 *
 * The failure this prevents is silent rather than loud: a bare identifier is refused as invalid
 * parameters, which arrives as a rejected read rather than as a wrong number, and a screen that
 * renders a missing balance as nothing turns that into "you hold none of this".
 */
export function walletAssetId(assetId: string): string {
  if (!WALLET_CHAIN_ID) {
    throw new Error('The wallet has no chain for this build, so no asset can be named to it.')
  }

  // Already qualified: pass it through rather than qualifying it twice. Nothing in this dapp
  // does that today, and a caller that starts to should not have its id quietly corrupted.
  if (assetId.includes('/elip144:')) return assetId

  return `${WALLET_CHAIN_ID}/elip144:${assetId}`
}
