import type { Pset, Transaction, WalletTxOut, Wollet } from '@lilbonekit/lwk-web'
import { useQueryClient } from '@tanstack/react-query'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react'

import { useWalletBalances } from '@/api/wallet/hooks'
import { invalidateAllWalletQueries } from '@/api/wallet/invalidateWalletQueries'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { NO_WALLET_CAPABILITIES, useWalletAdapters } from '@/lib/wallet/adapters'
import {
  describeWalletFailure,
  WalletCapabilityUnavailableError,
  WalletNotConnectedError,
  WalletUnavailableError,
} from '@/lib/wallet/errors'
import { scriptPubkeyFromDescriptor } from '@/lib/wallet/lwk'
import type {
  CachePolicy,
  WalletActionRequest,
  WalletAdapter,
  WalletCapabilities,
  WalletConnectOptions,
} from '@/lib/wallet/types'
import { ErrorHandler } from '@/utils/errorHandler'

import type { WalletChoice, WalletFacadeValue } from './types'
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
 * Where this account receives, when the connected wallet can say.
 *
 * A wallet holding the descriptor itself serves no address and this stays null, which is what the
 * screens that ask are written for. One whose outputs this page can see has an address from the
 * moment it opened, and withholding it left the pending-transaction bell hidden for exactly the
 * wallets that broadcast from here.
 */
function useReceiveAddress(
  accountId: string | null,
  capabilities: WalletCapabilities,
): string | null {
  const [resolved, setResolved] = useState<{ accountId: string; address: string } | null>(null)

  useEffect(() => {
    if (accountId === null) return

    let current = true

    Promise.resolve(capabilities.getReceiveAddress?.() ?? null)
      .then(address => {
        if (current && address !== null) setResolved({ accountId, address })
      })
      .catch(ErrorHandler.process)

    return () => {
      current = false
    }
  }, [accountId, capabilities])

  return resolved?.accountId === accountId ? resolved.address : null
}

/**
 * The wallet the dapp is acting through, from among the ones it can act through at all.
 *
 * The person's own pick wins. Nothing picked falls back to whichever wallet is already connected
 * or is coming back from an approval this origin still holds — a reload restores a session with
 * nobody pressing anything, and a facade that waited to be told would report no wallet while one
 * was plainly connected.
 */
function useSelectedAdapter(
  adapters: readonly WalletAdapter[],
  pickedId: string | null,
): WalletAdapter | null {
  return useMemo(() => {
    const picked = pickedId === null ? undefined : adapters.find(one => one.id === pickedId)

    return picked ?? adapters.find(one => one.state === 'connected' || one.restoring) ?? null
  }, [adapters, pickedId])
}

/**
 * The one seam between this application and any wallet.
 *
 * Everything a screen can ask a wallet is on the value below, and every wallet reaches it
 * through one adapter. Adding a wallet is writing an adapter; it is never another path from a
 * screen to a connector, which is what this replaces.
 */
export function WalletFacadeProvider({ children }: PropsWithChildren) {
  const adapters = useWalletAdapters()
  const queryClient = useQueryClient()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [showFailure, setShowFailure] = useState(false)

  const wallet = useSelectedAdapter(adapters, pickedId)
  // Everything asked of a wallet goes through this, so a read that arrives while none is selected
  // refuses by name instead of being answered by whichever adapter happened to be built first.
  const capabilities = wallet?.capabilities ?? NO_WALLET_CAPABILITIES

  // What the wallet calls the account: an identifier, not an address. Reads are keyed on it and
  // it is what a change of account is noticed by; the address a person receives at is derived.
  const account = wallet?.account?.address ?? null
  const scriptPubkey = useAccountScript(account, capabilities)
  const receiveAddress = useReceiveAddress(account, capabilities)

  const balancesQuery = useWalletBalances(capabilities, account, SHOWN_ASSET_IDS)

  // What the wallet last said about an account is untrue rather than stale once the account
  // changes, so the reads are dropped instead of being left to expire.
  useEffect(() => {
    invalidateAllWalletQueries(queryClient)
  }, [account, queryClient])

  /*
   * A wallet that scans the chain finds things nobody asked about — on its own timer, and whenever
   * the tab comes back to the front. What it found is not in these reads until they are asked
   * again, so an account that received money while the tab sat there went on showing the balance
   * from before it arrived until somebody pressed something. The old provider published those
   * numbers directly; this is the same thing through the reads that replaced it.
   */
  const chainUpdates = wallet?.chainUpdates ?? 0

  useEffect(() => {
    if (chainUpdates === 0) return

    invalidateAllWalletQueries(queryClient)
  }, [chainUpdates, queryClient])

  const connect = useCallback(
    async (walletId: string, options?: WalletConnectOptions) => {
      const chosen = adapters.find(one => one.id === walletId)

      if (!chosen) {
        throw new WalletUnavailableError(
          `This dapp cannot act through a wallet called ${walletId}.`,
        )
      }

      setShowFailure(false)
      setPickedId(walletId)
      try {
        await chosen.connect(options)
        setFailure(null)
      } catch (error) {
        // The pick is given up with the attempt. Held on to, a wallet that refused would go on
        // standing in front of one that is actually connected.
        setPickedId(null)
        /*
         * One boundary owns this failure, and it is this one: the message below is what a person
         * reads, on the screen they pressed the wallet on. Reporting is separate from presenting —
         * a toast here as well would say the same thing twice, in what a transport happened to
         * throw rather than in words written for a reader. It is still rethrown, because the
         * caller asked whether the wallet connected and is owed the answer.
         */
        ErrorHandler.processWithoutFeedback(error)
        setFailure(describeWalletFailure(error, 'connect this wallet'))
        setShowFailure(true)
        throw error
      }
    },
    [adapters],
  )

  /*
   * Give the account up, and tell the wallet what to do with what was cached for it.
   *
   * A wallet that holds the descriptor itself has nothing cached here and both policies reach the
   * same place. One whose chain state this page scanned and stored has to be told, because keeping
   * it is what makes the next connect cheap and dropping it is what "forget this account" means.
   */
  const disconnect = useCallback(
    async (options?: { cachePolicy?: CachePolicy }) => {
      await wallet?.disconnect(options)
      setPickedId(null)
      setFailure(null)
      setShowFailure(false)
      invalidateAllWalletQueries(queryClient)
    },
    [queryClient, wallet],
  )

  /*
   * What a screen means by "sync" and what a transaction builder means by it are not the same
   * thing, and the difference is a wrong transaction rather than a stale number.
   *
   * A screen means "ask the wallet again what this account holds". Every builder calls this
   * immediately before listing outputs to fund from, and means "reread the chain" — a wallet that
   * keeps its own output set has to, because the set it is holding may have been spent from since
   * it was read. So the chain is reread first, by the wallet that has one to reread, and the
   * balances are asked for after, when they can answer from what the rescan found.
   */
  const cancelPendingRequest = useCallback(async () => {
    await wallet?.cancelPendingRequest?.()
  }, [wallet])

  const syncWallet = useCallback(async () => {
    await capabilities.rescan?.()
    await balancesQuery.refetch()
  }, [balancesQuery, capabilities])

  /*
   * The wallet's answer, or none at all.
   *
   * A wallet that holds the descriptor itself serves no descriptor an address can be derived from
   * and no call that returns one, so there is nowhere to get one and this says so. It does not
   * hand back the account identifier, which is what it used to do and what threw on every page
   * load; the callers turn a null into "Missing receive address", which is at least true.
   */
  const getReceiveAddress = useCallback(
    async () => (await capabilities.getReceiveAddress?.()) ?? null,
    [capabilities],
  )

  const performAction = useCallback(
    (request: WalletActionRequest) => capabilities.performAction(request),
    [capabilities],
  )

  const openAccount = useCallback(() => wallet?.openAccount(), [wallet])

  const wallets = useMemo<readonly WalletChoice[]>(
    () =>
      adapters.map(one => ({
        id: one.id,
        name: one.name,
        isAvailable: one.isAvailable,
        unavailableReason: one.unavailableReason,
        requiresRecoveryPhrase: one.requiresRecoveryPhrase ?? false,
      })),
    [adapters],
  )

  const value = useMemo<WalletFacadeValue>(() => {
    const held = balancesQuery.data ?? {}
    /*
     * Three views of the same reads.
     *
     * A wallet that scans the chain says what has confirmed; one that answers from inside an
     * extension says only a total, and for it the confirmed view is that total — which is what
     * this dapp has always shown for it, stated here rather than fabricated per screen. Nothing
     * is entered under an asset the wallet said nothing about.
     */
    const totals: Record<string, string> = {}
    const confirmed: Record<string, string> = {}
    const pending: Record<string, string> = {}

    for (const [assetId, amount] of Object.entries(held)) {
      totals[assetId] = amount.total
      confirmed[assetId] = amount.confirmed ?? amount.total
      if (amount.pending !== null && amount.pending !== '0') pending[assetId] = amount.pending
    }

    const connected = wallet?.state === 'connected'
    // Picked, and still answering: a device waiting for its PIN is being acted through even
    // though nothing can be asked of it yet.
    const engaged =
      connected || wallet?.state === 'locked' || wallet?.state === 'connecting' || false
    // A read that failed leaves no entries, and an account that holds nothing leaves no entries
    // either. Carrying the reason apart from the numbers is what keeps a wallet that refused
    // from being rendered as a wallet that is empty.
    const balancesUnavailableReason = balancesQuery.isError
      ? describeWalletFailure(balancesQuery.error, 'read this account\u2019s balances')
      : null

    /*
     * Served by the connected wallet, or refused in its name.
     *
     * The facade used to refuse these for every wallet, because there was one wallet and it could
     * not serve them. Now it refuses for a wallet that cannot and passes the call through to one
     * that can, so the refusal is a fact about what is connected rather than about this file.
     */
    const serveOrRefuse = <Served,>(
      served: (() => Promise<Served>) | undefined,
      capability: string,
      reason: string,
    ): (() => Promise<Served>) => {
      if (served) return served

      // Two different refusals, and saying the wrong one tells somebody something untrue about
      // their wallet. Nothing connected is nothing connected; a wallet that is connected and
      // cannot do this is refused in its own name.
      if (!wallet) return () => Promise.reject(new WalletNotConnectedError(capability))

      return () => Promise.reject(new WalletCapabilityUnavailableError(capability, reason))
    }

    return {
      wallets,
      connectionStatus: connected
        ? 'ready'
        : wallet?.state === 'locked'
          ? 'locked'
          : 'disconnected',
      connectorId: engaged ? (wallet?.id ?? null) : null,
      signerType: connected ? wallet.signerType : null,
      account,
      isReady: connected,
      reconnecting: wallet?.restoring ?? false,
      syncing: wallet?.state === 'connecting' || balancesQuery.isFetching,
      balances: totals,
      confirmedBalances: confirmed,
      pendingBalances: pending,
      balancesUnavailableReason,
      receiveAddress,
      scriptPubkey,
      pendingRequest: wallet?.pendingRequest ?? null,
      usbDeviceDetected: wallet?.usbDeviceDetected ?? false,
      walletVariant: wallet?.variant ?? null,
      error: failure,
      isError: showFailure,

      connect,
      disconnect,
      cancelPendingRequest,
      openAccount,
      syncWallet,
      getReceiveAddress,
      performAction,

      getWollet: serveOrRefuse<Wollet>(
        capabilities.getWollet?.bind(capabilities),
        'hand out a wallet object',
        DESCRIPTOR_IS_THE_WALLETS,
      ),
      getBlindedWalletUtxos: serveOrRefuse<WalletTxOut[]>(
        capabilities.getBlindedWalletUtxos?.bind(capabilities),
        'list blinded outputs',
        DESCRIPTOR_IS_THE_WALLETS,
      ),
      signPset: (pset: Pset) => {
        if (capabilities.signPset) return capabilities.signPset(pset)

        return Promise.reject(
          wallet
            ? new WalletCapabilityUnavailableError(
                'sign a transaction built here',
                SIGNING_IS_THE_WALLETS,
              )
            : new WalletNotConnectedError('signing a transaction'),
        )
      },
      applyBroadcastTransaction: (tx: Transaction) => {
        // A wallet that keeps its own output set takes the transaction up at once, so the screens
        // move as soon as it is sent rather than at the next scan. One that does not is simply
        // asked again — nothing local holds a balance for it.
        capabilities.applyBroadcastTransaction?.(tx)
        invalidateAllWalletQueries(queryClient)
      },
    }
  }, [
    account,
    balancesQuery.data,
    cancelPendingRequest,
    capabilities,
    balancesQuery.error,
    balancesQuery.isError,
    balancesQuery.isFetching,
    connect,
    disconnect,
    failure,
    getReceiveAddress,
    openAccount,
    performAction,
    queryClient,
    receiveAddress,
    scriptPubkey,
    showFailure,
    syncWallet,
    wallet,
    wallets,
  ])

  return <WalletFacadeContext.Provider value={value}>{children}</WalletFacadeContext.Provider>
}
