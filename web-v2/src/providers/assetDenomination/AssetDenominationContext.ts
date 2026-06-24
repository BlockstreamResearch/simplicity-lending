import { createContext } from 'react'

import type { PolicyAssetDenomination } from './constants'

export interface AssetDenominationContextValue {
  denomination: PolicyAssetDenomination
  setDenomination: (denomination: PolicyAssetDenomination) => void
}

export const AssetDenominationContext = createContext<AssetDenominationContextValue | null>(null)
