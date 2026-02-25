/** Selected mode on Utility page. */
export type UtilityMode = 'split-native' | 'split-asset' | 'merge' | 'burn'

export const UTILITY_MODES: { mode: UtilityMode; label: string }[] = [
  { mode: 'split-native', label: 'Split LBTC' },
  { mode: 'split-asset', label: 'Split asset' },
  { mode: 'merge', label: 'Merge' },
  { mode: 'burn', label: 'Burn' },
]
