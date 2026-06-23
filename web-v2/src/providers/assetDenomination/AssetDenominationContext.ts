import { createContext } from 'react'

import type { PolicyAssetDenomination } from './types'

export interface AssetDenominationContextValue {
  denomination: PolicyAssetDenomination
  setDenomination: (denomination: PolicyAssetDenomination) => void
  toggleDenomination: () => void
}

export const AssetDenominationContext = createContext<AssetDenominationContextValue | null>(null)
