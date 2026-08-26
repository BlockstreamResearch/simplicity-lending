/**
 * Every wallet this dapp can act through, in the order the picker offers them.
 *
 * One list, built here and nowhere else. The facade selects from it by id and knows no wallet by
 * name; a wallet joins the dapp by being written as an adapter and added to this file, which is
 * the whole of what "adding a wallet" means now.
 */

import { useMemo } from 'react'

import { WalletNotConnectedError } from '@/lib/wallet/errors'
import { useHumidWallet } from '@/lib/wallet/humid/adapter'
import { useJadeWallet } from '@/lib/wallet/jade/adapter'
import { useSeedWallet } from '@/lib/wallet/seed/adapter'
import { useSideSwapWallet } from '@/lib/wallet/sideswap/adapter'
import type { WalletAdapter, WalletCapabilities } from '@/lib/wallet/types'

/**
 * What is asked of a wallet while none is selected.
 *
 * Every member refuses by name and immediately. The alternative — leaving these unserved and
 * letting a read run against whichever adapter happens to be first — would answer for an account
 * nobody connected.
 */
export const NO_WALLET_CAPABILITIES: WalletCapabilities = {
  getWalletDescriptor: () => Promise.reject(new WalletNotConnectedError('reading a descriptor')),
  getBalance: () => Promise.reject(new WalletNotConnectedError('reading a balance')),
  getUtxos: () => Promise.reject(new WalletNotConnectedError('reading spendable outputs')),
  performAction: () => Promise.reject(new WalletNotConnectedError('performing an action')),
}

/**
 * The adapters, built once per render.
 *
 * Each is a hook and so runs whether or not it is the one selected — the Rules of Hooks leave no
 * other arrangement. An adapter must therefore be inert until its own `connect` is called: it may
 * look for what is already on the page, and it may not open a port, a socket or a device.
 */
export function useWalletAdapters(): readonly WalletAdapter[] {
  const humid = useHumidWallet()
  const jade = useJadeWallet()
  const seed = useSeedWallet()
  const sideswap = useSideSwapWallet()

  return useMemo(() => [humid, jade, seed, sideswap], [humid, jade, seed, sideswap])
}
