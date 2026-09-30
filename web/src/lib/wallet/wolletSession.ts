/**
 * The chain, as a wallet that keeps its own outputs sees it.
 *
 * A wallet that hands this page a descriptor leaves it holding the account: this page builds the
 * chain library's wallet object, scans for what the account owns, caches that scan so a reconnect
 * does not redownload it, and keeps it current while the tab is open. A wallet that holds the
 * descriptor itself does none of this and never opens one of these.
 *
 * Everything here already ran, in `providers/wallet/WalletProvider.tsx`, for the three connectors
 * that were connected before the facade existed. It is moved rather than written again: the cache
 * namespace, the cross-tab lock, the throttle and the reconciliation of a just-broadcast
 * transaction against a scan that may predate it are each a bug that was already found once.
 */

import type { Pset, Transaction, WalletTxOut, Wollet, WolletDescriptor } from '@lilbonekit/lwk-web'
import { Registry } from '@lilbonekit/lwk-web'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { WalletNotConnectedError, WalletUnavailableError } from '@/lib/wallet/errors'
import type { CachePolicy, WalletCapabilities } from '@/lib/wallet/types'
import { createCachedWollet, type WalletCache } from '@/lib/wallet-core/store/walletCache'
import {
  applyBroadcastTransaction,
  readWalletBalances,
  reconcilePendingBroadcasts,
  syncBalances,
  type WalletBalances,
} from '@/lib/wallet-core/wallet/sync'
import { createEsploraClient } from '@/lwk'
import { useOptionalLwk } from '@/providers/lwk/useLwk'

/** How often an open session rereads the chain on its own. */
const RESCAN_INTERVAL_MS = 60_000
/**
 * The least time between two rescans.
 *
 * A scan redownloads the whole history listing even when nothing has changed, and a tab coming
 * back to the front fires both the focus and the visibility handler, so repeated triggers
 * collapse into one. A rescan a builder asked for runs regardless — it follows a broadcast — but
 * still feeds this, so the poll does not repeat the same scan seconds later.
 */
const MIN_RESCAN_GAP_MS = 15_000

const NO_BALANCES: WalletBalances = { total: {}, confirmed: {}, pending: {} }

const CHAIN_LIBRARY_MISSING = 'The chain library is not loaded on this page.'

interface OpenSession {
  wollet: Wollet
  cache: WalletCache
  esploraClient: ReturnType<typeof createEsploraClient>
}

/** The members of the facade's contract that only a wallet with its own outputs can serve. */
export type WolletBackedCapabilities = Required<
  Pick<
    WalletCapabilities,
    | 'getWollet'
    | 'getBlindedWalletUtxos'
    | 'getReceiveAddress'
    | 'rescan'
    | 'applyBroadcastTransaction'
  >
>

export interface WolletSession {
  /** Whether an account's chain state is open here. */
  readonly isOpen: boolean
  /** Whether a scan is in flight. */
  readonly syncing: boolean
  /**
   * How many times this session has taken up something new from the chain.
   *
   * The number itself means nothing; that it changed does. A scan this page did not ask for — the
   * timer, or a tab coming back to the front — moves what the account holds, and whatever is
   * showing those numbers has to be told, or it goes on showing the scan before last until
   * somebody presses something.
   */
  readonly chainUpdates: number
  /**
   * What the last scan or applied transaction says this account holds, read rather than watched.
   *
   * Every rescan changes the balances, and an adapter that rebuilt what it serves each time would
   * hand the facade a new capabilities object once a minute — which is a descriptor parse and a
   * wallet build for an account that has not changed. This one function does not change, so what
   * is built from it does not either.
   */
  readBalances(): WalletBalances
  /**
   * The transactions this session broadcast and has not seen confirmed.
   *
   * What a new transaction's fee has to beat. They are already tracked here — they are what a
   * scan is reconciled against — and an action built without them can be assembled at a rate a
   * still-unconfirmed transaction of this wallet's already paid, and wait behind it.
   */
  pendingBroadcastTxids(): readonly string[]
  /** Where this account receives, derived once when the session opened. */
  readonly receiveAddress: string | null
  /**
   * Build this descriptor's wallet, take up what is cached for it, and scan the chain once.
   *
   * Answers with the address this account receives at, because the caller needs it in the same
   * breath and cannot get it any other way: what it holds of this session was captured before the
   * session existed, and a state update cannot reach back into a closure that has already been
   * made. Null when the session was replaced while it was opening.
   */
  open(descriptor: WolletDescriptor): Promise<string | null>
  /** Give the account up, keeping or dropping the scan that was cached for it. */
  close(options?: { cachePolicy?: CachePolicy }): Promise<void>
  /**
   * Put what the asset registry knows into a transaction before it is signed.
   *
   * ELIP-0100 contract data for every registered asset the account owns, which is what lets a
   * device show an asset's name rather than its hash. A registry that cannot be reached is not a
   * signing failure: the transaction signs either way, and the person reads a hash.
   */
  addAssetContracts(pset: Pset): Promise<Pset>
  readonly capabilities: WolletBackedCapabilities
}

/**
 * One account's chain state, owned by whichever adapter opened it.
 *
 * Inert until `open`: an adapter that is built on every render and never picked holds no database
 * handle, no lock and no timer.
 */
export function useWolletSession(): WolletSession {
  const lwk = useOptionalLwk()

  const sessionRef = useRef<OpenSession | null>(null)
  // Self-broadcast transactions the indexer has not confirmed yet, reapplied after every scan so
  // a scan that predates them cannot silently undo what they already showed.
  const pendingBroadcastsRef = useRef<Map<string, Transaction>>(new Map())
  // Bumped whenever the session ends or changes, so work started by one session cannot write its
  // result into the next.
  const generationRef = useRef(0)
  const rescanInFlightRef = useRef(false)
  const lastRescanAtRef = useRef(0)
  // The registry metadata already fetched, keyed by the owned-asset set that seeded it.
  const registryRef = useRef<{ key: string; registry: Registry } | null>(null)

  // The balances as a value that can be read without watching them, beside the state the screens
  // render from.
  const balancesRef = useRef<WalletBalances>(NO_BALANCES)

  const [isOpen, setIsOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [chainUpdates, setChainUpdates] = useState(0)
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null)

  /** Take up what a completed scan found, unless the session it belonged to has ended. */
  const takeUp = useCallback((generation: number, session: OpenSession) => {
    if (generation !== generationRef.current) return

    const confirmedTxids = reconcilePendingBroadcasts(session.wollet, pendingBroadcastsRef.current)
    confirmedTxids.forEach(txid => pendingBroadcastsRef.current.delete(txid))

    balancesRef.current = readWalletBalances(session.wollet)
    setChainUpdates(taken => taken + 1)
  }, [])

  const rescan = useCallback(async () => {
    const session = sessionRef.current

    if (!session) return

    const generation = generationRef.current

    rescanInFlightRef.current = true
    setSyncing(true)
    try {
      await syncBalances(session.wollet, session.esploraClient)
      takeUp(generation, session)
    } finally {
      if (generation === generationRef.current) {
        rescanInFlightRef.current = false
        lastRescanAtRef.current = Date.now()
        setSyncing(false)
      }
    }
  }, [takeUp])

  const open = useCallback(
    async (descriptor: WolletDescriptor) => {
      if (!lwk) throw new WalletUnavailableError(CHAIN_LIBRARY_MISSING)

      const { lwkNetwork, network } = lwk
      const generation = ++generationRef.current
      const { wollet, cache } = await createCachedWollet(lwkNetwork, network, descriptor)

      if (generation !== generationRef.current) {
        await cache.close().catch(console.warn)

        return null
      }

      const esploraClient = createEsploraClient(lwkNetwork)

      sessionRef.current = { wollet, cache, esploraClient }
      setIsOpen(true)

      // Derived once, from the descriptor rather than from the chain: it is where this account
      // receives whether or not anything has ever been sent there. Both objects hold Rust memory
      // and are given back as soon as the string is out of them.
      const derived = wollet.address(0)
      const address = derived.address()
      let receivesAt: string

      try {
        receivesAt = address.toString()
      } finally {
        address.free()
        derived.free()
      }

      setReceiveAddress(receivesAt)

      setSyncing(true)
      try {
        await syncBalances(wollet, esploraClient)
        takeUp(generation, sessionRef.current)
      } finally {
        if (generation === generationRef.current) {
          lastRescanAtRef.current = Date.now()
          setSyncing(false)
        }
      }

      return receivesAt
    },
    [lwk, takeUp],
  )

  const close = useCallback(async (options?: { cachePolicy?: CachePolicy }) => {
    generationRef.current++

    const session = sessionRef.current

    sessionRef.current = null
    // A scan started by the session that is ending keeps running and skips its own bookkeeping as
    // stale, so the flag is cleared here or the next session could never rescan.
    rescanInFlightRef.current = false
    pendingBroadcastsRef.current.clear()
    setIsOpen(false)
    setSyncing(false)
    balancesRef.current = NO_BALANCES
    setChainUpdates(0)
    setReceiveAddress(null)

    // The registry outlives no session: it was fetched for the assets this account owns.
    registryRef.current?.registry.free()
    registryRef.current = null

    if (!session) return

    const cache = session.cache

    await (options?.cachePolicy === 'clear' ? cache.clearAndClose() : cache.close()).catch(
      console.warn,
    )
    // Last, and after the cache it writes through: a scanned wallet is the largest thing this page
    // holds in Rust memory, and a person switching wallets would otherwise leave one behind each
    // time.
    session.wollet.free()
  }, [])

  /*
   * The chain moves without this page. An open session rereads it on a timer, and again whenever
   * the tab comes back to the front, because a person who left the tab for an hour comes back to
   * balances an hour old and no sign that they are.
   */
  useEffect(() => {
    if (!isOpen) return

    const rereadIfDue = () => {
      if (sessionRef.current === null) return
      if (rescanInFlightRef.current) return
      if (Date.now() - lastRescanAtRef.current < MIN_RESCAN_GAP_MS) return

      rescan().catch(console.warn)
    }

    const timer = setInterval(rereadIfDue, RESCAN_INTERVAL_MS)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') rereadIfDue()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', rereadIfDue)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', rereadIfDue)
    }
  }, [isOpen, rescan])

  const readBalances = useCallback(() => balancesRef.current, [])

  const pendingBroadcastTxids = useCallback(() => [...pendingBroadcastsRef.current.keys()], [])

  const addAssetContracts = useCallback(
    async (pset: Pset): Promise<Pset> => {
      const session = sessionRef.current

      if (!session) return pset

      if (!lwk) return pset

      try {
        const owned = session.wollet.assetsOwned()
        const key = owned.toString()

        if (registryRef.current?.key !== key) {
          const registry = await Registry.defaultForNetwork(lwk.lwkNetwork, owned)

          registryRef.current?.registry.free()
          registryRef.current = { key, registry }
        }

        return registryRef.current.registry.addContracts(pset)
      } catch (error) {
        console.warn('Signing without asset metadata (registry unavailable):', error)

        return pset
      }
    },
    [lwk],
  )

  const capabilities = useMemo<WolletBackedCapabilities>(
    () => ({
      getWollet: async () => requireOpen(sessionRef.current).wollet,
      // The chain library hands these out blinded, and blinded is what a builder needs: it
      // unblinds them itself to choose inputs, and spends the same objects.
      getBlindedWalletUtxos: async (): Promise<WalletTxOut[]> =>
        requireOpen(sessionRef.current).wollet.utxos(),
      getReceiveAddress: async () => receiveAddress,
      rescan,
      applyBroadcastTransaction: (tx: Transaction) => {
        const session = sessionRef.current

        if (!session) return

        try {
          balancesRef.current = applyBroadcastTransaction(session.wollet, tx)
          pendingBroadcastsRef.current.set(tx.txid().toString(), tx)
          setChainUpdates(taken => taken + 1)
        } catch (error) {
          // The transaction is already sent, and a scan will find it. This showing it sooner is
          // worth trying and never worth failing the broadcast over.
          console.warn(error)
        }
      },
    }),
    [receiveAddress, rescan],
  )

  return useMemo(
    () => ({
      isOpen,
      syncing,
      chainUpdates,
      readBalances,
      pendingBroadcastTxids,
      receiveAddress,
      open,
      close,
      addAssetContracts,
      capabilities,
    }),
    [
      addAssetContracts,
      capabilities,
      chainUpdates,
      close,
      isOpen,
      open,
      pendingBroadcastTxids,
      readBalances,
      receiveAddress,
      syncing,
    ],
  )
}

/** The open session, or the reason there is nothing to answer with. */
function requireOpen(session: OpenSession | null): OpenSession {
  if (!session) throw new WalletNotConnectedError('reading this account from the chain')

  return session
}
