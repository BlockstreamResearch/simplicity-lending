import { createContext } from 'react'

import type { WalletContextValue } from './types'

export const WALLET_CONTEXT_UNINITIALIZED = Symbol('WALLET_CONTEXT_UNINITIALIZED')

export const WalletContext = createContext<
  WalletContextValue | typeof WALLET_CONTEXT_UNINITIALIZED
>(WALLET_CONTEXT_UNINITIALIZED)
