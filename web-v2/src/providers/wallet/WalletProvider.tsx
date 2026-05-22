import type { Pset } from 'lwk_web'
import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '@/constants/env'
import { useSessionStorage } from '@/hooks/useSessionStorage'
import { JadeConnector } from '@/lib/wallet-core/connector/jade'
import { SeedConnector } from '@/lib/wallet-core/connector/seed'
import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import type { WalletType } from '@/lib/wallet-core/types'
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
  const { lwk, lwkNetwork } = useLwk()

  const sessionRef = useRef<WalletSession | null>(null)

  const [state, setState] = useState<WalletState>(() => {
    const disconnectError = sessionStorage.getItem(DISCONNECT_ERROR_KEY)
    if (disconnectError) {
      sessionStorage.removeItem(DISCONNECT_ERROR_KEY)
      return { ...INITIAL_WALLET_STATE, error: disconnectError, isError: true }
    }
    return INITIAL_WALLET_STATE
  })
  const [savedSession, setSavedSession] = useSessionStorage<SavedSession>(SESSION_STORAGE_KEY)

  // Stable disconnect used by polling, USB events, and the public disconnect action.
  const performDisconnect = useCallback(
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
        performDisconnect('Device disconnected')
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
  }, [performDisconnect])

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
          performDisconnect('Device disconnected').catch(console.warn)
        })
    }, 3_000)

    return () => clearInterval(id)
  }, [state.connectionStatus, performDisconnect])

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
      if (sessionRef.current !== null) return

      setState(s => ({ ...s, syncing: true, error: null, isError: false }))

      let connector: WalletConnector | null = null

      try {
        const walletType: WalletType = env.VITE_DEBUG_MNEMONIC ? 'Wpkh' : variant

        connector = env.VITE_DEBUG_MNEMONIC
          ? new SeedConnector(lwk, lwkNetwork, env.VITE_DEBUG_MNEMONIC)
          : new JadeConnector(lwk, lwkNetwork)

        await connector.connect()

        const connectionStatus = await connector.getConnectionStatus()

        // Show the intermediate state (locked/ready) before PIN prompt blocks.
        setState(s => ({
          ...s,
          connectionStatus,
          connectorId: connector!.id,
          walletType,
        }))

        const descriptor = await connector.getDescriptor(walletType)
        const wollet = new lwk.Wollet(lwkNetwork, descriptor)
        const esploraClient = createEsploraClient(lwk, lwkNetwork)

        sessionRef.current = { connector, descriptor, wollet, esploraClient }

        const saved: SavedSession = {
          connectorId: connector.id,
          walletType,
          descriptorStr: descriptor.toString(),
        }
        setSavedSession(saved)

        const balances = await syncBalances(wollet, esploraClient)

        setState(s => ({
          ...s,
          connectionStatus: 'ready',
          syncing: false,
          error: null,
          isError: false,
          balances,
        }))
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        connector?.disconnect()
        sessionStorage.setItem(DISCONNECT_ERROR_KEY, error)
        // TODO: Move to a more robust error handling strategy
        if (error.toLowerCase().includes('pin')) {
          window.location.reload()
        }
      }
    },
    [lwk, lwkNetwork, setSavedSession],
  )

  const disconnect = useCallback(async () => {
    await performDisconnect()
  }, [performDisconnect])

  const resumeSession = useCallback(async () => {
    if (!savedSession) return
    await connect(savedSession.walletType)
  }, [savedSession, connect])

  const autoResumedRef = useRef(false)
  useEffect(() => {
    if (autoResumedRef.current || !savedSession || state.connectionStatus !== 'disconnected') return
    autoResumedRef.current = true
    resumeSession().catch(() => performDisconnect().catch(console.warn))
  }, [savedSession, state.connectionStatus, resumeSession, performDisconnect])

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

  const signAndBroadcast = useCallback(async (pset: Pset): Promise<string> => {
    const session = sessionRef.current
    if (!session) throw new Error('WalletProvider: not connected')

    const signedPset = await session.connector.signPset(pset)
    const finalizedPset = session.wollet.finalize(signedPset)
    const txid = await session.esploraClient.broadcast(finalizedPset)
    const txidStr = txid.toString()

    // Auto-sync balances after broadcast (fire-and-forget, errors are non-fatal).
    syncBalances(session.wollet, session.esploraClient)
      .then(balances => {
        setState(s => ({ ...s, balances }))
      })
      .catch(console.warn)

    return txidStr
  }, [])

  const getLastReceiveAddress = useCallback(async (): Promise<string | null> => {
    const session = sessionRef.current
    if (!session) return null
    return session.wollet.address().address().toString()
  }, [])

  const getXOnlyPublicKey = useCallback(async (): Promise<string | null> => {
    const session = sessionRef.current
    if (!session) return null
    return session.connector.getXOnlyPublicKey?.() ?? null
  }, [])

  const verifyReceiveAddress = useCallback(async (): Promise<string | null> => {
    const session = sessionRef.current
    if (!session) return null
    if (!session.connector.getVerifiedReceiveAddress)
      return session.wollet.address().address().toString()

    return session.connector.getVerifiedReceiveAddress(state.walletType ?? 'Wpkh', session.wollet)
  }, [state.walletType])

  const sendLbtc = useCallback(
    async (recipientAddress: string, satoshi: bigint): Promise<string> => {
      const session = sessionRef.current
      if (!session) throw new Error('WalletProvider: not connected')

      const addr = lwk.Address.parse(recipientAddress, lwkNetwork)
      const txBuilder = await new lwk.TxBuilder(lwkNetwork)
        .feeRate(100)
        .addLbtcRecipient(addr, satoshi)
      const pset = txBuilder.finish(session.wollet)
      return signAndBroadcast(pset)
    },
    [lwk, lwkNetwork, signAndBroadcast],
  )

  return (
    <WalletContext.Provider
      value={{
        ...state,
        connect,
        disconnect,
        syncWallet: sync,
        signAndBroadcast,
        sendLbtc,
        getLastReceiveAddress,
        verifyReceiveAddress,
        getXOnlyPublicKey,
        resumeSession,
        savedSession,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}
