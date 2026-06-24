import { useContext } from 'react'

import { AssetDenominationContext } from './AssetDenominationContext'

export function useAssetDenomination() {
  const context = useContext(AssetDenominationContext)
  if (!context) {
    throw new Error('useAssetDenomination must be used within AssetDenominationProvider')
  }
  return context
}
