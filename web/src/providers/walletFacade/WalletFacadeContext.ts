import { createContext } from 'react'

import type { WalletFacadeValue } from './types'

export const WALLET_FACADE_UNINITIALIZED = Symbol('WALLET_FACADE_UNINITIALIZED')

export const WalletFacadeContext = createContext<
  WalletFacadeValue | typeof WALLET_FACADE_UNINITIALIZED
>(WALLET_FACADE_UNINITIALIZED)
