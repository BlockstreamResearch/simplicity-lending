import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AssetDenominationContext } from './AssetDenominationContext'
import {
  DEFAULT_POLICY_ASSET_DENOMINATION,
  isPolicyAssetDenomination,
  POLICY_ASSET_DENOMINATION_STORAGE_KEY,
  type PolicyAssetDenomination,
} from './types'

function readStoredDenomination(): PolicyAssetDenomination {
  if (typeof window === 'undefined') return DEFAULT_POLICY_ASSET_DENOMINATION
  const stored = window.localStorage.getItem(POLICY_ASSET_DENOMINATION_STORAGE_KEY)
  return isPolicyAssetDenomination(stored) ? stored : DEFAULT_POLICY_ASSET_DENOMINATION
}

export function AssetDenominationProvider({ children }: PropsWithChildren) {
  const [denomination, setDenominationState] =
    useState<PolicyAssetDenomination>(readStoredDenomination)

  useEffect(() => {
    window.localStorage.setItem(POLICY_ASSET_DENOMINATION_STORAGE_KEY, denomination)
  }, [denomination])

  const setDenomination = useCallback((nextDenomination: PolicyAssetDenomination) => {
    setDenominationState(nextDenomination)
  }, [])

  const toggleDenomination = useCallback(() => {
    setDenominationState(current => (current === 'lbtc' ? 'sats' : 'lbtc'))
  }, [])

  const value = useMemo(
    () => ({ denomination, setDenomination, toggleDenomination }),
    [denomination, setDenomination, toggleDenomination],
  )

  return (
    <AssetDenominationContext.Provider value={value}>{children}</AssetDenominationContext.Provider>
  )
}
