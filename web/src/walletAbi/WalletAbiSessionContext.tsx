import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  WalletAbiClient,
  createWalletConnectRequester,
  type WalletAbiRequester,
} from 'wallet-abi-sdk-alpha'
import type {
  TxCreateRequest,
  TxCreateResponse,
  WalletAbiNetwork,
} from 'wallet-abi-sdk-alpha/schema'
import {
  getScriptPubkeyHexFromAddress,
  inferWalletAbiNetworkFromAddress,
} from '../utility/addressP2pk'
import {
  createWalletAbiSessionController,
  resolveWalletAbiNetwork,
  type WalletAbiSessionController,
} from './walletConnectSession'
import { rememberWalletScript } from './walletScriptStorage'
import { getReownProjectId, getWalletAbiNetworkValue } from '../config/runtimeConfig'

type WalletAbiSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface WalletAbiSessionValue {
  status: WalletAbiSessionStatus
  error: string | null
  signerReceiveAddress: string | null
  signingXOnlyPubkey: string | null
  signerScriptPubkeyHex: string | null
  network: WalletAbiNetwork | null
  connect(): Promise<void>
  disconnect(): Promise<void>
  processRequest(request: TxCreateRequest): Promise<TxCreateResponse>
}

const REQUEST_TIMEOUT_MS = 120_000
const WalletAbiSessionContext = createContext<WalletAbiSessionValue | null>(null)

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}

export function WalletAbiSessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<WalletAbiSessionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [signerReceiveAddress, setSignerReceiveAddress] = useState<string | null>(null)
  const [signingXOnlyPubkey, setSigningXOnlyPubkey] = useState<string | null>(null)
  const [signerScriptPubkeyHex, setSignerScriptPubkeyHex] = useState<string | null>(null)
  const [network, setNetwork] = useState<WalletAbiNetwork | null>(null)

  const controllerRef = useRef<WalletAbiSessionController | null>(null)
  const controllerPromiseRef = useRef<Promise<WalletAbiSessionController> | null>(null)
  const clientRef = useRef<WalletAbiClient | null>(null)
  const connectionPromiseRef = useRef<Promise<WalletAbiClient> | null>(null)

  const walletAbiNetwork = resolveWalletAbiNetwork(getWalletAbiNetworkValue())
  const reownProjectId = getReownProjectId()

  const clearSessionIdentity = () => {
    setSignerReceiveAddress(null)
    setSigningXOnlyPubkey(null)
    setSignerScriptPubkeyHex(null)
    setNetwork(null)
  }

  const setDisconnected = () => {
    clientRef.current = null
    connectionPromiseRef.current = null
    clearSessionIdentity()
    setError(null)
    setStatus('disconnected')
  }

  const buildRequester = (controller: WalletAbiSessionController): WalletAbiRequester => {
    return createWalletConnectRequester({
      chainId: controller.chainId,
      client: {
        connect() {
          return controller.connect().then(() => undefined)
        },
        disconnect() {
          return controller.disconnect()
        },
        request({ request }) {
          return controller.request(request)
        },
      },
      getTopic() {
        return controller.session()?.topic ?? null
      },
    })
  }

  const getClient = (controller: WalletAbiSessionController): WalletAbiClient => {
    const currentClient = clientRef.current
    if (currentClient !== null) {
      return currentClient
    }

    const nextClient = new WalletAbiClient({
      requester: buildRequester(controller),
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    })
    clientRef.current = nextClient
    return nextClient
  }

  const getController = async (): Promise<WalletAbiSessionController> => {
    if (reownProjectId.length === 0) {
      throw new Error('Missing VITE_REOWN_PROJECT_ID')
    }

    const currentController = controllerRef.current
    if (currentController !== null) {
      return currentController
    }

    if (controllerPromiseRef.current !== null) {
      return controllerPromiseRef.current
    }

    const nextControllerPromise = createWalletAbiSessionController({
      projectId: reownProjectId,
      network: walletAbiNetwork,
      origin: window.location.origin,
    }).then((controller) => {
      controllerRef.current = controller
      return controller
    })

    controllerPromiseRef.current = nextControllerPromise

    try {
      return await nextControllerPromise
    } finally {
      controllerPromiseRef.current = null
    }
  }

  const hydrateSession = async (controller: WalletAbiSessionController): Promise<WalletAbiClient> => {
    const client = getClient(controller)
    const nextAddress = await client.getSignerReceiveAddress()
    const nextPubkey = await client.getRawSigningXOnlyPubkey()
    const nextScript = await getScriptPubkeyHexFromAddress(nextAddress)

    setSignerReceiveAddress(nextAddress)
    setSigningXOnlyPubkey(nextPubkey)
    setSignerScriptPubkeyHex(nextScript)
    setNetwork(inferWalletAbiNetworkFromAddress(nextAddress))
    setError(null)
    setStatus('connected')

    return client
  }

  const ensureConnected = async (): Promise<WalletAbiClient> => {
    if (connectionPromiseRef.current !== null) {
      return connectionPromiseRef.current
    }

    const currentController = controllerRef.current
    const currentClient = clientRef.current
    const hasHydratedIdentity =
      signerReceiveAddress !== null &&
      signingXOnlyPubkey !== null &&
      signerScriptPubkeyHex !== null &&
      network !== null

    // Reuse an active WalletConnect session so tx requests do not bounce the app
    // back to "connecting" and remount the borrower/lender pages mid-flow.
    if (currentController !== null && currentController.session() !== null) {
      if (currentClient !== null && hasHydratedIdentity) {
        return currentClient
      }
      return hydrateSession(currentController)
    }

    const nextConnectionPromise = (async () => {
      try {
        setStatus('connecting')
        const controller = await getController()
        await controller.connect()
        return await hydrateSession(controller)
      } catch (nextError) {
        clearSessionIdentity()
        setError(errorMessage(nextError))
        setStatus('error')
        throw nextError
      } finally {
        connectionPromiseRef.current = null
      }
    })()

    connectionPromiseRef.current = nextConnectionPromise
    return nextConnectionPromise
  }

  useEffect(() => {
    if (!signingXOnlyPubkey || !network || !signerScriptPubkeyHex) return
    rememberWalletScript(signingXOnlyPubkey, network, signerScriptPubkeyHex)
  }, [network, signerScriptPubkeyHex, signingXOnlyPubkey])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      try {
        const controller = await getController()

        unsubscribe = controller.subscribe({
          onConnected() {
            if (cancelled) return
            void hydrateSession(controller).catch((nextError) => {
              if (cancelled) return
              clearSessionIdentity()
              setError(errorMessage(nextError))
              setStatus('error')
            })
          },
          onUpdated() {
            if (cancelled) return
            void hydrateSession(controller).catch((nextError) => {
              if (cancelled) return
              clearSessionIdentity()
              setError(errorMessage(nextError))
              setStatus('error')
            })
          },
          onDisconnected() {
            if (cancelled) return
            setDisconnected()
          },
        })

        if (controller.session() !== null) {
          await hydrateSession(controller)
          return
        }

        if (!cancelled) {
          setDisconnected()
        }
      } catch (nextError) {
        if (cancelled) return
        clearSessionIdentity()
        setError(errorMessage(nextError))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [reownProjectId, walletAbiNetwork])

  const value: WalletAbiSessionValue = {
    status,
    error,
    signerReceiveAddress,
    signingXOnlyPubkey,
    signerScriptPubkeyHex,
    network,
    async connect() {
      await ensureConnected()
    },
    async disconnect() {
      const controller = controllerRef.current
      setDisconnected()
      if (controller !== null) {
        await controller.disconnect().catch(() => undefined)
      }
    },
    async processRequest(request) {
      const client = await ensureConnected()
      return client.processRequest(request)
    },
  }

  return (
    <WalletAbiSessionContext.Provider value={value}>{children}</WalletAbiSessionContext.Provider>
  )
}

export function useWalletAbiSession(): WalletAbiSessionValue {
  const value = useContext(WalletAbiSessionContext)
  if (value === null) {
    throw new Error('WalletAbiSessionContext is missing')
  }
  return value
}
