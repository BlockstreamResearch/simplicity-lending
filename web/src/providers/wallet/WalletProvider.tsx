import { type Pset, type Transaction, type Wollet, WolletBuilder } from '@lilbonekit/lwk-web'
import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '@/constants/env'
import { useSessionStorage } from '@/hooks/useSessionStorage'
import { JadeBusyError, JadeDisconnectedError } from '@/lib/wallet-core/connector/errors'
import { JadeConnector } from '@/lib/wallet-core/connector/jade'
import { SeedConnector } from '@/lib/wallet-core/connector/seed'
import { SideSwapConnector } from '@/lib/wallet-core/connector/sideswap'
import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import { DEFAULT_WALLET_TYPE, type WalletType } from '@/lib/wallet-core/types'
import {
  applyBroadcastTransaction,
  readWalletBalances,
  reconcilePendingBroadcasts,
  syncBalances,
} from '@/lib/wallet-core/wallet/sync'
import { createEsploraClient } from '@/lwk'
import { useLwk } from '@/providers/lwk/useLwk'
import { ErrorHandler } from '@/utils/errorHandler'

import {
  type ConnectOptions,
  INITIAL_WALLET_STATE,
  type SavedSession,
  type WalletSession,
  type WalletState,
} from './types'
import { WalletContext } from './WalletContext'

const SESSION_STORAGE_KEY = 'jade_wallet_session'

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { lwkNetwork } = useLwk()

  const sessionRef = useRef<WalletSession | null>(null)
  const connectingRef = useRef(false)
  // Cancels the in-flight SideSwap login/sign request, if any.
  const pendingCancelRef = useRef<(() => Promise<void>) | null>(null)
  // Self-broadcast txs not yet confirmed per the indexer — reconciled after every full
  // scan so a stale scan can't silently undo their locally-applied effect.
  const pendingBroadcastsRef = useRef<Map<string, Transaction>>(new Map())
  // Invalidates stale connect() attempts and prevents duplicate disconnect handling.
  const connectionChangeCounterRef = useRef(0)

  const [state, setState] = useState<WalletState>(INITIAL_WALLET_STATE)
  const [savedSession, setSavedSession] = useSessionStorage<SavedSession>(SESSION_STORAGE_KEY)

  const disconnect = useCallback(
    async (error?: string) => {
      connectionChangeCounterRef.current++
      const session = sessionRef.current
      sessionRef.current = null
      // Reset UI immediately. Connector teardown runs in background and may hang if the device
      // was unplugged mid-session.
      session?.connector.disconnect().catch(console.warn)
      setSavedSession(null)
      setState(s => ({
        ...INITIAL_WALLET_STATE,
        usbDeviceDetected: s.usbDeviceDetected,
        error: error ?? null,
        isError: error !== undefined,
      }))
    },
    [setSavedSession],
  )

  // Bump the counter (via disconnect) before the network-bound cancel RPC, so the in-flight
  // connect()/signPset() sees it invalidated instead of racing this function's state reset.
  const cancelPendingRequest = useCallback(async () => {
    const cancel = pendingCancelRef.current
    pendingCancelRef.current = null
    await disconnect()
    if (cancel) await cancel().catch(console.warn)
  }, [disconnect])

  // Permanent Web Serial event listeners — detect USB plug/unplug.
  useEffect(() => {
    if (!('serial' in navigator)) return

    const handleConnect = () => {
      // Clear any prior disconnect error when the user re-plugs the device.
      setState(s => ({ ...s, usbDeviceDetected: true, error: null, isError: false }))
    }
    const handleDisconnect = () => {
      setState(s => ({ ...s, usbDeviceDetected: false }))
      // Covers disconnects during the PIN/unlock flow as well.
      // (waiting on the device's PIN entry) and hasn't set sessionRef.current yet.
      if (sessionRef.current || connectingRef.current) {
        const err = new JadeDisconnectedError()
        ErrorHandler.process(err)
        disconnect(err.message).catch(console.warn)
      }
    }

    navigator.serial.addEventListener('connect', handleConnect)
    navigator.serial.addEventListener('disconnect', handleDisconnect)

    return () => {
      navigator.serial.removeEventListener('connect', handleConnect)
      navigator.serial.removeEventListener('disconnect', handleDisconnect)
    }
  }, [disconnect])

  // Poll Jade state while connected — detects PIN lock and physical disconnect.
  useEffect(() => {
    if (state.connectionStatus === 'disconnected') return

    const id = setInterval(() => {
      const session = sessionRef.current
      if (!session || connectingRef.current) return

      session.connector
        .getConnectionStatus()
        .then(status => {
          if (status === 'locked' && state.connectionStatus !== 'locked') {
            // Force a clean reconnect so the PIN flow restarts from scratch.
            disconnect().catch(console.warn)
            return
          }
          setState(s => (s.connectionStatus === status ? s : { ...s, connectionStatus: status }))
        })
        .catch((err: unknown) => {
          if (err instanceof JadeBusyError) return
          ErrorHandler.process(err)
          disconnect(new JadeDisconnectedError().message).catch(console.warn)
        })
    }, 3_000)

    return () => clearInterval(id)
  }, [state.connectionStatus, disconnect])

  useEffect(() => {
    if (state.connectionStatus !== 'ready') return

    const refreshBalances = () => {
      const session = sessionRef.current
      if (!session) return
      syncBalances(session.wollet, session.esploraClient)
        .then(() => {
          const confirmedTxids = reconcilePendingBroadcasts(
            session.wollet,
            pendingBroadcastsRef.current,
          )
          confirmedTxids.forEach(txid => pendingBroadcastsRef.current.delete(txid))

          const { total, confirmed, pending } = readWalletBalances(session.wollet)
          setState(s => ({
            ...s,
            balances: total,
            confirmedBalances: confirmed,
            pendingBalances: pending,
          }))
        })
        .catch(console.warn)
    }

    const id = setInterval(refreshBalances, 60_000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshBalances()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', refreshBalances)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', refreshBalances)
    }
  }, [state.connectionStatus])

  const connect = useCallback(
    async (variant: WalletType, options?: ConnectOptions) => {
      if (sessionRef.current !== null || connectingRef.current) return
      connectingRef.current = true
      const attempt = ++connectionChangeCounterRef.current

      const useSideSwap = options?.sideswap === true
      // seedMnemonic is a runtime choice from the demo-mode seed connect form; falling back to
      // VITE_DEBUG_MNEMONIC preserves the existing local-dev auto-connect behavior.
      const mnemonic = useSideSwap ? null : options?.seedMnemonic || env.VITE_DEBUG_MNEMONIC || null
      const isJade = !useSideSwap && mnemonic === null
      const signerType = useSideSwap ? 'sideswap' : isJade ? 'jade' : 'seed'
      setState(s => ({ ...s, syncing: true, error: null, isError: false }))

      let connector: WalletConnector | null = null
      try {
        if (useSideSwap && !env.VITE_SIDESWAP_WS_URL) {
          throw new Error('VITE_SIDESWAP_WS_URL is not set')
        }

        const walletType: WalletType = isJade ? variant : DEFAULT_WALLET_TYPE

        connector = (() => {
          if (useSideSwap) return new SideSwapConnector(env.VITE_SIDESWAP_WS_URL!)
          if (mnemonic === null) return new JadeConnector(lwkNetwork)
          return new SeedConnector(lwkNetwork, mnemonic)
        })()

        await connector.connect()
        // The native 'connect' event only fires for a device that was already paired and
        // got replugged — a fresh pick-and-connect never triggers it.
        setState(s => ({ ...s, usbDeviceDetected: isJade, signerType }))
        const connectionStatus = await connector.getConnectionStatus()

        if (attempt !== connectionChangeCounterRef.current) {
          connector.disconnect().catch(console.warn)
          return
        }

        // Show 'locked' in the UI before getDescriptor() blocks waiting for Jade PIN.
        if (connectionStatus === 'locked') {
          setState(s => ({
            ...s,
            connectionStatus: 'locked',
            connectorId: connector!.id,
            walletType,
          }))
        }

        // resumeOnly: don't start a fresh login request nobody can see if there's no live session.
        if (options?.resumeOnly && connectionStatus !== 'ready') {
          connector.disconnect().catch(console.warn)
          sessionRef.current = null
          setState(s => ({ ...INITIAL_WALLET_STATE, usbDeviceDetected: s.usbDeviceDetected }))
          return
        }

        const request = await connector.getDescriptor(walletType)
        pendingCancelRef.current = request.cancel ?? null
        if (request.requestId) {
          const appLink = request.appLink ?? null
          setState(s => ({
            ...s,
            pendingRequest: { kind: 'login', requestId: request.requestId!, appLink },
          }))
          if (appLink) window.location.href = appLink
        }

        const descriptor = await request.result
        pendingCancelRef.current = null
        setState(s => (s.pendingRequest ? { ...s, pendingRequest: null } : s))

        if (attempt !== connectionChangeCounterRef.current) {
          connector.disconnect().catch(console.warn)
          return
        }

        if (connectionStatus === 'locked') {
          setState(s => ({ ...s, connectionStatus: 'disconnected' }))
        }

        const wollet = new WolletBuilder(lwkNetwork, descriptor).utxoOnly(true).build()
        const esploraClient = createEsploraClient(lwkNetwork)

        sessionRef.current = { connector, descriptor, wollet, esploraClient }

        const saved: SavedSession = {
          connectorId: connector.id,
          walletType,
          descriptorStr: descriptor.toString(),
          seedMnemonic: mnemonic ?? undefined,
          sideswap: useSideSwap,
        }
        setSavedSession(saved)

        const {
          total: balances,
          confirmed: confirmedBalances,
          pending: pendingBalances,
        } = await syncBalances(wollet, esploraClient)
        if (attempt !== connectionChangeCounterRef.current) return

        const address = wollet.address(0).address()
        const receiveAddress = address.toString()
        const scriptPubkey = address.scriptPubkey().toString()

        setState(s => ({
          ...s,
          connectionStatus: 'ready',
          syncing: false,
          error: null,
          isError: false,
          balances,
          confirmedBalances,
          pendingBalances,
          receiveAddress,
          scriptPubkey,
        }))
      } catch (err) {
        if (attempt !== connectionChangeCounterRef.current) {
          connector?.disconnect().catch(console.warn)
          return
        }
        ErrorHandler.process(err)
        const error = err instanceof Error ? err.message : String(err)
        // Not awaited — same hang risk as in disconnect(): update state immediately
        // instead of gating it behind the connector's own teardown.
        connector?.disconnect().catch(console.warn)
        sessionRef.current = null
        setState(s => ({
          ...INITIAL_WALLET_STATE,
          usbDeviceDetected: s.usbDeviceDetected,
          error,
          isError: true,
        }))
      } finally {
        connectingRef.current = false
      }
    },
    [lwkNetwork, setSavedSession],
  )

  const resumeSession = useCallback(async () => {
    if (!savedSession) return
    await connect(savedSession.walletType, {
      seedMnemonic: savedSession.seedMnemonic,
      sideswap: savedSession.sideswap,
      resumeOnly: savedSession.sideswap,
    })
  }, [savedSession, connect])

  const autoResumedRef = useRef(false)
  useEffect(() => {
    if (autoResumedRef.current || !savedSession || state.connectionStatus !== 'disconnected') return
    autoResumedRef.current = true
    setState(s => ({ ...s, reconnecting: true }))
    resumeSession()
      .catch(() => disconnect().catch(console.warn))
      .finally(() => setState(s => ({ ...s, reconnecting: false })))
  }, [savedSession, state.connectionStatus, resumeSession, disconnect])

  const sync = useCallback(async () => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')

    setState(s => ({ ...s, syncing: true, error: null }))

    try {
      await syncBalances(session.wollet, session.esploraClient)

      const confirmedTxids = reconcilePendingBroadcasts(
        session.wollet,
        pendingBroadcastsRef.current,
      )
      confirmedTxids.forEach(txid => pendingBroadcastsRef.current.delete(txid))

      const {
        total: balances,
        confirmed: confirmedBalances,
        pending: pendingBalances,
      } = readWalletBalances(session.wollet)
      setState(s => ({ ...s, syncing: false, balances, confirmedBalances, pendingBalances }))
    } catch (err) {
      ErrorHandler.process(err)
      const error = err instanceof Error ? err.message : String(err)
      setState(s => ({ ...s, syncing: false, error, isError: true }))
    }
  }, [])

  // Best-effort local UI update — the tx already broadcast successfully regardless of
  // this outcome, so failures here (e.g. a full scan racing this call) must not throw.
  const applyBroadcastTx = useCallback((tx: Transaction) => {
    const session = sessionRef.current
    if (!session) return

    try {
      const { total, confirmed, pending } = applyBroadcastTransaction(session.wollet, tx)
      pendingBroadcastsRef.current.set(tx.txid().toString(), tx)
      setState(s => ({
        ...s,
        balances: total,
        confirmedBalances: confirmed,
        pendingBalances: pending,
      }))
    } catch (err) {
      console.warn(err)
    }
  }, [])

  const signPset = useCallback(async (pset: Pset): Promise<Pset> => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')

    const request = await session.connector.signPset(pset)
    if (!request.requestId) return request.result

    pendingCancelRef.current = request.cancel ?? null
    setState(s => ({
      ...s,
      pendingRequest: {
        kind: 'sign',
        requestId: request.requestId!,
        appLink: request.appLink ?? null,
      },
    }))

    try {
      return await request.result
    } finally {
      pendingCancelRef.current = null
      setState(s => (s.pendingRequest ? { ...s, pendingRequest: null } : s))
    }
  }, [])

  // Returns the snapshot derived once on connect — single source of truth for the
  // deterministic address(0). Live wollet/utxos still come from get* below.
  const getReceiveAddress = useCallback(
    async (): Promise<string | null> => state.receiveAddress,
    [state.receiveAddress],
  )

  const verifyReceiveAddress = useCallback(async (): Promise<string> => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')
    if (!session.connector.getVerifiedReceiveAddress)
      return session.wollet.address(0).address().toString()

    return session.connector.getVerifiedReceiveAddress(
      state.walletType ?? DEFAULT_WALLET_TYPE,
      session.wollet,
    )
  }, [state.walletType])

  const getBlindedWalletUtxos = useCallback(async () => {
    const session = sessionRef.current

    if (!session) {
      throw new Error('WalletProvider: not connected')
    }

    // LWK returns blinded UTXOs, which are spendable by LWK
    return session.wollet.utxos()
  }, [])

  const getWollet = useCallback(async (): Promise<Wollet> => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')

    return session.wollet
  }, [])

  return (
    <WalletContext.Provider
      value={{
        ...state,
        isReady: state.connectionStatus === 'ready',
        connect,
        cancelPendingRequest,
        disconnect,
        syncWallet: sync,
        applyBroadcastTransaction: applyBroadcastTx,
        signPset,
        getReceiveAddress,
        verifyReceiveAddress,
        getWollet,
        getBlindedWalletUtxos,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}
