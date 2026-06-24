import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'

import { useLocalStorage } from '@/hooks/useLocalStorage'

import { AssetDenominationContext } from './AssetDenominationContext'
import {
  DEFAULT_POLICY_ASSET_DENOMINATION,
  isPolicyAssetDenomination,
  POLICY_ASSET_DENOMINATION_STORAGE_KEY,
} from './constants'

export function AssetDenominationProvider({ children }: PropsWithChildren) {
  const [denomination, setDenomination] = useLocalStorage(
    POLICY_ASSET_DENOMINATION_STORAGE_KEY,
    DEFAULT_POLICY_ASSET_DENOMINATION,
    isPolicyAssetDenomination,
  )

  const value = useMemo(() => ({ denomination, setDenomination }), [denomination, setDenomination])

  return (
    <AssetDenominationContext.Provider value={value}>{children}</AssetDenominationContext.Provider>
  )
}
