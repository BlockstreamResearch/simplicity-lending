import { type Pset, type Wollet, WolletBuilder } from '@lilbonekit/lwk-web'
import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '@/constants/env'
import { useSessionStorage } from '@/hooks/useSessionStorage'
import { JadeBusyError, JadeDisconnectedError } from '@/lib/wallet-core/connector/errors'
import { JadeConnector } from '@/lib/wallet-core/connector/jade'
import { SeedConnector } from '@/lib/wallet-core/connector/seed'
import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import { DEFAULT_WALLET_TYPE, type WalletType } from '@/lib/wallet-core/types'
import { syncBalances } from '@/lib/wallet-core/wallet/sync'
import { createEsploraClient } from '@/lwk'
import { useLwk } from '@/providers/lwk/useLwk'
import { ErrorHandler } from '@/utils/errorHandler'

import {
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

    const id = setInterval(() => {
      const session = sessionRef.current
      if (!session) return
      syncBalances(session.wollet, session.esploraClient)
        .then(rawBalances => {
          setState(s => ({ ...s, balances: rawBalances }))
        })
        .catch(console.warn)
    }, 60_000)

    return () => clearInterval(id)
  }, [state.connectionStatus])

  const connect = useCallback(
    async (variant: WalletType) => {
      if (sessionRef.current !== null || connectingRef.current) return
      connectingRef.current = true
      const attempt = ++connectionChangeCounterRef.current

      const isJade = !env.VITE_DEBUG_MNEMONIC
      setState(s => ({ ...s, syncing: true, error: null, isError: false }))

      let connector: WalletConnector | null = null
      try {
        const walletType: WalletType = isJade ? variant : DEFAULT_WALLET_TYPE

        connector = isJade
          ? new JadeConnector(lwkNetwork)
          : new SeedConnector(lwkNetwork, env.VITE_DEBUG_MNEMONIC)

        await connector.connect()
        // The native 'connect' event only fires for a device that was already paired and
        // got replugged — a fresh pick-and-connect never triggers it.
        setState(s => ({ ...s, usbDeviceDetected: isJade, signerType: isJade ? 'jade' : 'seed' }))
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

        const descriptor = await connector.getDescriptor(walletType)

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
        }
        setSavedSession(saved)

        const balances = await syncBalances(wollet, esploraClient)
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
    await connect(savedSession.walletType)
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
      const balances = await syncBalances(session.wollet, session.esploraClient)
      setState(s => ({ ...s, syncing: false, balances }))
    } catch (err) {
      ErrorHandler.process(err)
      const error = err instanceof Error ? err.message : String(err)
      setState(s => ({ ...s, syncing: false, error, isError: true }))
    }
  }, [])

  const signPset = useCallback(async (pset: Pset): Promise<Pset> => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')

    return session.connector.signPset(pset)
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
        disconnect,
        syncWallet: sync,
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
