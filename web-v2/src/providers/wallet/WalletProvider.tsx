import { type Pset, Wollet, type XOnlyPublicKey } from 'lwk_web'
import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '@/constants/env'
import { useSessionStorage } from '@/hooks/useSessionStorage'
import { JadeConnector } from '@/lib/wallet-core/connector/jade'
import { SeedConnector } from '@/lib/wallet-core/connector/seed'
import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import { DEFAULT_WALLET_TYPE, type WalletType } from '@/lib/wallet-core/types'
import { syncBalances } from '@/lib/wallet-core/wallet/sync'
import { createEsploraClient } from '@/lwk'
import { useLwk } from '@/providers/lwk/useLwk'

import {
  INITIAL_WALLET_STATE,
  type SavedSession,
  type WalletSession,
  type WalletState,
} from './types'
import { WalletContext } from './WalletContext'

const SESSION_STORAGE_KEY = 'jade_wallet_session'
const DISCONNECT_ERROR_KEY = 'jade_disconnect_error'

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { lwkNetwork } = useLwk()

  const sessionRef = useRef<WalletSession | null>(null)
  const connectingRef = useRef(false)

  const [state, setState] = useState<WalletState>(() => {
    const disconnectError = sessionStorage.getItem(DISCONNECT_ERROR_KEY)
    if (disconnectError) {
      sessionStorage.removeItem(DISCONNECT_ERROR_KEY)
      return { ...INITIAL_WALLET_STATE, error: disconnectError, isError: true }
    }
    return INITIAL_WALLET_STATE
  })
  const [savedSession, setSavedSession] = useSessionStorage<SavedSession>(SESSION_STORAGE_KEY)

  const disconnect = useCallback(
    async (error?: string) => {
      const session = sessionRef.current
      if (session) {
        session.connector.disconnect()
        sessionRef.current = null
      }
      setSavedSession(null)
      // Persist the error so it survives the reload that releases the serial port.
      if (error !== undefined) {
        sessionStorage.setItem(DISCONNECT_ERROR_KEY, error)
      }
      window.location.reload()
    },
    [setSavedSession],
  )

  // Release the WebSerial port before page unload to avoid Jade's -32003
  // (network inconsistency) error on reload. beforeunload cannot await promises,
  // so we fire-and-forget — jade.free() is a synchronous WASM call under the hood.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const session = sessionRef.current
      if (session) {
        session.connector.disconnect()
        sessionRef.current = null
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Permanent Web Serial event listeners — detect USB plug/unplug.
  useEffect(() => {
    if (!('serial' in navigator)) return

    const handleConnect = () => {
      // Clear any prior disconnect error when the user re-plugs the device.
      setState(s => ({ ...s, usbDeviceDetected: true, error: null, isError: false }))
    }
    const handleDisconnect = () => {
      if (sessionRef.current) {
        disconnect('Device disconnected')
      } else {
        setState(s => ({ ...s, usbDeviceDetected: false }))
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
      if (!session) return

      session.connector
        .getConnectionStatus()
        .then(status => {
          if (status === 'locked' && state.connectionStatus !== 'locked') {
            window.location.reload() // to prompt for PIN again and avoid serial port conflicts
          }
          setState(s => (s.connectionStatus === status ? s : { ...s, connectionStatus: status }))
        })
        .catch((err: unknown) => {
          // TODO: Move to a more robust error handling strategy
          if (err instanceof Error && err.message === 'jade:busy') return
          disconnect('Device disconnected').catch(console.warn)
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

      setState(s => ({ ...s, syncing: true, error: null, isError: false }))

      let connector: WalletConnector | null = null

      try {
        const walletType: WalletType = env.VITE_DEBUG_MNEMONIC ? DEFAULT_WALLET_TYPE : variant

        connector = env.VITE_DEBUG_MNEMONIC
          ? new SeedConnector(lwkNetwork, env.VITE_DEBUG_MNEMONIC)
          : new JadeConnector(lwkNetwork)

        await connector.connect()
        const connectionStatus = await connector.getConnectionStatus()

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
        const wollet = new Wollet(lwkNetwork, descriptor)
        const esploraClient = createEsploraClient(lwkNetwork)

        sessionRef.current = { connector, descriptor, wollet, esploraClient }

        const saved: SavedSession = {
          connectorId: connector.id,
          walletType,
          descriptorStr: descriptor.toString(),
        }
        setSavedSession(saved)

        const balances = await syncBalances(wollet, esploraClient)

        const address = wollet.address(0).address()
        const receiveAddress = address.toString()
        const scriptPubkey = address.scriptPubkey().toString()
        const xOnlyPubkey = (await connector.getXOnlyPublicKey?.())?.toString() ?? null

        setState(s => ({
          ...s,
          connectionStatus: 'ready',
          syncing: false,
          error: null,
          isError: false,
          balances,
          receiveAddress,
          scriptPubkey,
          xOnlyPubkey,
        }))
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        connector?.disconnect()
        sessionRef.current = null
        // TODO: Move to a more robust error handling strategy
        if (error.toLowerCase().includes('pin')) {
          sessionStorage.setItem(DISCONNECT_ERROR_KEY, error)
          window.location.reload()
        } else {
          setState(s => ({
            ...INITIAL_WALLET_STATE,
            usbDeviceDetected: s.usbDeviceDetected,
            error,
            isError: true,
          }))
        }
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
    resumeSession().catch(() => disconnect().catch(console.warn))
  }, [savedSession, state.connectionStatus, resumeSession, disconnect])

  const sync = useCallback(async () => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')

    setState(s => ({ ...s, syncing: true, error: null }))

    try {
      const balances = await syncBalances(session.wollet, session.esploraClient)
      setState(s => ({ ...s, syncing: false, balances }))
    } catch (err) {
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

  const getXOnlyPublicKey = useCallback(async (): Promise<XOnlyPublicKey | null> => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')
    return session.connector.getXOnlyPublicKey?.() ?? null
  }, [])

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

  const getWalletUtxos = useCallback(async () => {
    const session = sessionRef.current

    if (!session) {
      throw new Error('WalletProvider: not connected')
    }

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
        getXOnlyPublicKey,
        getWollet,
        getWalletUtxos,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}
