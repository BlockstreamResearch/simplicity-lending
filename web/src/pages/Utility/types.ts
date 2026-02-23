/** Selected mode on Utility page. */
export type UtilityMode = 'split-native' | 'split-asset' | 'merge'

export const UTILITY_MODES: { mode: UtilityMode; label: string }[] = [
  { mode: 'split-native', label: 'Split LBTC' },
  { mode: 'split-asset', label: 'Split asset' },
  { mode: 'merge', label: 'Merge' },
]
