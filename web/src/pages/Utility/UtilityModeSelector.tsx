/**
 * Mode selector: Split LBTC, Split asset, or Merge.
 * Shown when user lands on Utility page; after selection the corresponding builder is shown.
 */

import type { UtilityMode } from './types'

export interface UtilityModeSelectorProps {
  onSelect: (mode: UtilityMode) => void
}

const MODES: { mode: UtilityMode; label: string; description: string }[] = [
  {
    mode: 'split-native',
    label: 'Split LBTC',
    description: 'Spend one LBTC UTXO into multiple outputs plus change and fee.',
  },
  {
    mode: 'split-asset',
    label: 'Split asset',
    description: 'Split a custom asset UTXO (fee from LBTC UTXO, asset from second UTXO).',
  },
  {
    mode: 'merge',
    label: 'Merge',
    description: 'Combine multiple UTXOs into fewer outputs.',
  },
]

export function UtilityModeSelector({ onSelect }: UtilityModeSelectorProps) {
  return (
    <section className="min-w-0 max-w-4xl mt-10">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">What do you want to do?</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {MODES.map(({ mode, label, description }) => (
          <button
            key={mode}
            type="button"
            className="text-left p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors"
            onClick={() => onSelect(mode)}
          >
            <p className="font-medium text-gray-900">{label}</p>
            <p className="text-sm text-gray-600 mt-1">{description}</p>
          </button>
        ))}
      </div>
    </section>
  )
}
