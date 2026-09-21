import { useContext } from 'react'

import type { WalletFacadeValue } from './types'
import { WALLET_FACADE_UNINITIALIZED, WalletFacadeContext } from './WalletFacadeContext'

/** The one way anything in this application reaches a wallet. */
export function useWallet(): WalletFacadeValue {
  const ctx = useContext(WalletFacadeContext)

  if (ctx === WALLET_FACADE_UNINITIALIZED) {
    throw new Error('useWallet() must be used within <WalletFacadeProvider />')
  }

  return ctx
}
