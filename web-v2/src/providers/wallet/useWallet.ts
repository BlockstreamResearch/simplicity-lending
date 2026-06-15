import { useContext } from 'react'

import type { WalletContextValue } from './types'
import { WALLET_CONTEXT_UNINITIALIZED, WalletContext } from './WalletContext'

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (ctx === WALLET_CONTEXT_UNINITIALIZED) {
    throw new Error('useWallet() must be used within <WalletProvider />')
  }
  return ctx
}
