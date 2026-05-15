import type { Pset } from 'lwk_web'
import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '@/constants/env'
import { JadeConnector } from '@/lib/wallet-core/connector/jade'
import { SeedConnector } from '@/lib/wallet-core/connector/seed'
import type { WalletConnector } from '@/lib/wallet-core/connector/types'
import {
  INITIAL_WALLET_STATE,
  type SavedSession,
  type SinglesigVariant,
  type WalletState,
} from '@/lib/wallet-core/types'
import type { WalletSession } from '@/lib/wallet-core/wallet/session'
import { createEsploraClient, syncWallet } from '@/lib/wallet-core/wallet/sync'
import { useLwk } from '@/providers/lwk/useLwk'

import { WalletContext } from './WalletContext'

const SESSION_STORAGE_KEY = 'jade_wallet_session'

function loadSavedSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedSession) : null
  } catch {
    return null
  }
}

function persistSession(session: SavedSession): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function clearPersistedSession(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { lwk, lwkNetwork } = useLwk()

  const sessionRef = useRef<WalletSession | null>(null)

  const [state, setState] = useState<WalletState>(INITIAL_WALLET_STATE)
  const [savedSession, setSavedSession] = useState<SavedSession | null>(loadSavedSession)

  // Stable disconnect used by polling, USB events, and the public disconnect action.
  const performDisconnect = useCallback(async (error?: string) => {
    const session = sessionRef.current
    if (session) {
      await session.connector.disconnect()
      sessionRef.current = null
    }
    clearPersistedSession()
    setSavedSession(null)
    // Do NOT preserve usbDeviceDetected — physical disconnect means the device is gone.
    setState(() => ({
      ...INITIAL_WALLET_STATE,
      ...(error !== undefined ? { error, isError: true } : {}),
    }))
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
        performDisconnect('Device disconnected').catch(console.warn)
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
      if (!session?.connector.getConnectionState) return

      session.connector
        .getConnectionState()
        .then(status => {
          setState(s => (s.connectionStatus === status ? s : { ...s, connectionStatus: status }))
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === 'jade:busy') return
          performDisconnect('Device disconnected').catch(console.warn)
        })
    }, 3_000)

    return () => clearInterval(id)
  }, [state.connectionStatus, performDisconnect])

  const connect = useCallback(
    async (variant: SinglesigVariant) => {
      if (sessionRef.current !== null) return

      setState(s => ({ ...s, syncing: true, error: null, isError: false }))

      try {
        const connector: WalletConnector = env.VITE_DEBUG_MNEMONIC
          ? new SeedConnector(lwk, lwkNetwork, env.VITE_DEBUG_MNEMONIC)
          : new JadeConnector(lwk, lwkNetwork)

        await connector.connect()

        // Hardware signers expose readVersion; software signers are always 'ready'.
        const versionInfo = (await connector.readVersion?.()) ?? null
        const connectionStatus =
          versionInfo?.jadeState !== 'READY' && versionInfo !== null ? 'locked' : 'ready'

        // Show the intermediate state (locked/ready) before PIN prompt blocks.
        setState(s => ({
          ...s,
          connectionStatus,
          jadeMac: versionInfo?.jadeMac ?? null,
          walletType: variant,
        }))

        const descriptor = await connector.getDescriptor(variant)
        const wollet = new lwk.Wollet(lwkNetwork, descriptor)
        const esploraClient = createEsploraClient(lwk, lwkNetwork)

        sessionRef.current = { connector, descriptor, wollet, esploraClient }

        const saved: SavedSession = {
          efuseMac: versionInfo?.jadeMac ?? null,
          walletType: variant,
          descriptorStr: descriptor.toString(),
        }
        persistSession(saved)
        setSavedSession(saved)

        const rawBalances = await syncWallet(wollet, esploraClient)

        setState(s => ({
          ...s,
          connectionStatus: 'ready',
          syncing: false,
          error: null,
          isError: false,
          balances: serializeBalances(rawBalances),
        }))
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        sessionRef.current = null
        // USB may still be plugged in even if connect() failed, so preserve usbDeviceDetected.
        setState(s => ({
          ...INITIAL_WALLET_STATE,
          usbDeviceDetected: s.usbDeviceDetected,
          error,
          isError: true,
        }))
      }
    },
    [lwk, lwkNetwork],
  )

  const disconnect = useCallback(async () => {
    await performDisconnect()
  }, [performDisconnect])

  const resumeSession = useCallback(async () => {
    const saved = savedSession
    if (!saved) return
    await connect(saved.walletType)
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
      const rawBalances = await syncWallet(session.wollet, session.esploraClient)
      setState(s => ({ ...s, syncing: false, balances: serializeBalances(rawBalances) }))
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
    return txid.toString()
  }, [])

  const getLastReceiveAddress = useCallback((): string | null => {
    const session = sessionRef.current
    if (!session) return null
    return session.wollet.address().address().toString()
  }, [])

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
        sync,
        signAndBroadcast,
        sendLbtc,
        getLastReceiveAddress,
        resumeSession,
        savedSession,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

function serializeBalances(raw: [string, bigint][]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [assetId, amount] of raw) {
    result[assetId] = amount.toString()
  }
  return result
}
