/** Selected mode on Utility page. */
export type UtilityMode = 'split-native' | 'split-asset' | 'merge' | 'merge-asset' | 'burn'

export const UTILITY_MODES: { mode: UtilityMode; label: string }[] = [
  { mode: 'split-native', label: 'Split LBTC' },
  { mode: 'split-asset', label: 'Split asset' },
  { mode: 'merge', label: 'Merge LBTC' },
  { mode: 'merge-asset', label: 'Merge Asset' },
  { mode: 'burn', label: 'Burn' },
]
