/**
 * Dynamic success messages for post-broadcast modal by flow type.
 */

export type BroadcastMessageKey =
  | 'liquidation'
  | 'accept_offer'
  | 'create_offer'
  | 'prepare'
  | 'issue_utility_nfts'
  | 'burn'
  | 'merge'
  | 'merge_asset'
  | 'split'
  | 'split_asset'

export const BROADCAST_SUCCESS_MESSAGES: Record<BroadcastMessageKey, string> = {
  liquidation: 'Liquidation transaction successfully broadcast.',
  accept_offer: 'Offer accepted. Transaction successfully broadcast.',
  create_offer: 'Offer created. Transaction successfully broadcast.',
  prepare: 'Prepare transaction successfully broadcast.',
  issue_utility_nfts: 'Utility NFTs issued. Transaction successfully broadcast.',
  burn: 'Burn transaction successfully broadcast.',
  merge: 'Merge LBTC transaction successfully broadcast.',
  merge_asset: 'Merge asset transaction successfully broadcast.',
  split: 'Split transaction successfully broadcast.',
  split_asset: 'Split asset transaction successfully broadcast.',
}

export function getBroadcastSuccessMessage(key: BroadcastMessageKey): string {
  return BROADCAST_SUCCESS_MESSAGES[key]
}
