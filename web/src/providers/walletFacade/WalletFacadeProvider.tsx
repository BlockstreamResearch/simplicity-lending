import type { Pset, WalletTxOut, Wollet } from '@lilbonekit/lwk-web'
import { useQueryClient } from '@tanstack/react-query'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react'

import { useWalletBalances } from '@/api/wallet/hooks'
import { invalidateAllWalletQueries } from '@/api/wallet/invalidateWalletQueries'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { describeWalletFailure, WalletCapabilityUnavailableError } from '@/lib/wallet/errors'
import { useHumidWallet } from '@/lib/wallet/humid/adapter'
import { scriptPubkeyFromDescriptor } from '@/lib/wallet/lwk'
import type { WalletActionRequest, WalletCapabilities } from '@/lib/wallet/types'
import { ErrorHandler } from '@/utils/errorHandler'

import type { WalletFacadeValue } from './types'
import { WalletFacadeContext } from './WalletFacadeContext'

/** The assets these screens ask the wallet about. Short and fixed, so the reads are counted. */
const SHOWN_ASSET_IDS = [
  NETWORK_CONFIG.collateralAsset.id,
  NETWORK_CONFIG.principalAsset.id,
] as const

const DESCRIPTOR_IS_THE_WALLETS =
  'The wallet holds the account descriptor, so this page has no wallet object of its own.'
const SIGNING_IS_THE_WALLETS =
  'A transaction is built, checked and signed inside the wallet, from a protocol document.'

/**
 * The account's address and the script it pays to, derived from the descriptor it approved.
 *
 * Every read in this dapp — offers, positions, overviews — is asked of the indexer by script
 * rather than by address, so this is what identifies the account to everything above.
 *
 * The wallet publishes an account **identifier**, not an address: it is what the wallet's own
 * screens and calls name an account by, and it decodes as no address at all. Handing it to an
 * address parser is what this used to do, and it failed on every page load while leaving the
 * script null, which quietly emptied every screen keyed on one.
 */
function useAccountScript(
  accountId: string | null,
  capabilities: WalletCapabilities,
): string | null {
  const [derived, setDerived] = useState<{ accountId: string; script: string } | null>(null)

  useEffect(() => {
    if (accountId === null) return

    let current = true

    capabilities
      .getWalletDescriptor()
      .then(descriptor => scriptPubkeyFromDescriptor(descriptor))
      .then((script: string) => {
        if (current) setDerived({ accountId, script })
      })
      .catch(ErrorHandler.process)

    return () => {
      current = false
    }
  }, [accountId, capabilities])

  // Kept beside the account it came from, so a change of account reads as "not derived yet"
  // rather than showing the previous account's script until the new one arrives.
  return derived?.accountId === accountId ? derived.script : null
}

/**
 * The one seam between this application and any wallet.
 *
 * Everything a screen can ask a wallet is on the value below, and every wallet reaches it
 * through one adapter. Adding a wallet is writing an adapter; it is never another path from a
 * screen to a connector, which is what this replaces.
 */
export function WalletFacadeProvider({ children }: PropsWithChildren) {
  const wallet = useHumidWallet()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const [showFailure, setShowFailure] = useState(false)

  // What the wallet calls the account: an identifier, not an address. Reads are keyed on it and
  // it is what a change of account is noticed by; the address a person receives at is derived.
  const account = wallet.account?.address ?? null
  const scriptPubkey = useAccountScript(account, wallet.capabilities)

  const balancesQuery = useWalletBalances(wallet.capabilities, account, SHOWN_ASSET_IDS)

  // What the wallet last said about an account is untrue rather than stale once the account
  // changes, so the reads are dropped instead of being left to expire.
  useEffect(() => {
    invalidateAllWalletQueries(queryClient)
  }, [account, queryClient])

  const connect = useCallback(async () => {
    setShowFailure(false)
    try {
      await wallet.connect()
      setFailure(null)
    } catch (error) {
      ErrorHandler.process(error)
      setFailure(error instanceof Error ? error.message : String(error))
      setShowFailure(true)
      throw error
    }
  }, [wallet])

  // The wallet forgets the approval and nothing local survives it, so both cache policies reach
  // the same place. The screens still pass one, and the facade's type still accepts it.
  const disconnect = useCallback(async () => {
    await wallet.disconnect()
    setFailure(null)
    setShowFailure(false)
    invalidateAllWalletQueries(queryClient)
  }, [queryClient, wallet])

  const syncWallet = useCallback(async () => {
    await balancesQuery.refetch()
  }, [balancesQuery])

  /*
   * There is nowhere to get one. The wallet serves no descriptor an address can be derived from
   * and no call that returns one, so this says so rather than handing back the account
   * identifier, which is what it used to do and what threw on every page load.
   */
  const getReceiveAddress = useCallback(async () => null, [])

  const performAction = useCallback(
    (request: WalletActionRequest) => wallet.capabilities.performAction(request),
    [wallet],
  )

  const value = useMemo<WalletFacadeValue>(() => {
    const connected = wallet.state === 'connected'
    const balances = balancesQuery.data ?? {}
    // A read that failed leaves no entries, and an account that holds nothing leaves no entries
    // either. Carrying the reason apart from the numbers is what keeps a wallet that refused
    // from being rendered as a wallet that is empty.
    const balancesUnavailableReason = balancesQuery.isError
      ? describeWalletFailure(balancesQuery.error, 'read this account\u2019s balances')
      : null

    const refuse = (capability: string, reason: string) => () =>
      Promise.reject(new WalletCapabilityUnavailableError(capability, reason))

    return {
      hasWallet: wallet.isAvailable,
      walletUnavailableReason: wallet.unavailableReason,
      connectionStatus: connected ? 'ready' : 'disconnected',
      connectorId: connected ? wallet.id : null,
      signerType: connected ? 'humid' : null,
      account,
      isReady: connected,
      reconnecting: wallet.restoring,
      syncing: wallet.state === 'connecting' || balancesQuery.isFetching,
      balances,
      // The wallet reports one number per asset and does not split what has confirmed from
      // what has not, so the confirmed view is that number and the pending view is empty.
      // Showing a made-up split would read as a fact the wallet never stated.
      confirmedBalances: balances,
      pendingBalances: {},
      balancesUnavailableReason,
      receiveAddress: null,
      scriptPubkey,
      pendingRequest: null,
      error: failure,
      isError: showFailure,

      connect,
      disconnect,
      openAccount: wallet.openAccount,
      syncWallet,
      getReceiveAddress,
      performAction,

      getWollet: refuse(
        'hand out a wallet object',
        DESCRIPTOR_IS_THE_WALLETS,
      ) as () => Promise<Wollet>,
      getBlindedWalletUtxos: refuse(
        'list blinded outputs',
        DESCRIPTOR_IS_THE_WALLETS,
      ) as () => Promise<WalletTxOut[]>,
      signPset: refuse(
        'sign a transaction built here',
        SIGNING_IS_THE_WALLETS,
      ) as () => Promise<Pset>,
      applyBroadcastTransaction: () => {
        // Nothing local holds a balance to update any more; the wallet is asked again instead.
        invalidateAllWalletQueries(queryClient)
      },
    }
  }, [
    account,
    balancesQuery.data,
    balancesQuery.error,
    balancesQuery.isError,
    balancesQuery.isFetching,
    connect,
    disconnect,
    failure,
    getReceiveAddress,
    performAction,
    queryClient,
    scriptPubkey,
    showFailure,
    syncWallet,
    wallet,
  ])

  return <WalletFacadeContext.Provider value={value}>{children}</WalletFacadeContext.Provider>
}
