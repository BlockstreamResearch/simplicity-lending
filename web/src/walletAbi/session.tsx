/* eslint-disable react-refresh/only-export-components */
import {
  createGetRawSigningXOnlyPubkeyRequest,
  createGetSignerReceiveAddressRequest,
  createProcessRequest,
  createWalletAbiSessionController,
  createWalletConnectRequester,
  loadLwkWalletAbiWeb,
  parseGetRawSigningXOnlyPubkeyResponse,
  parseGetSignerReceiveAddressResponse,
  parseProcessRequestResponse,
  WalletAbiClient,
  type WalletAbiJsonRpcRequest,
  type WalletAbiJsonRpcResponse,
  type WalletAbiMethod,
  type WalletAbiSessionController,
  type WalletAbiTxCreateRequest,
  type WalletAbiTxCreateResponse,
} from 'lwk_wallet_abi_sdk'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getWalletAbiTransportNetwork, getWalletConnectProjectId } from '../config/runtimeConfig'

export type WalletConnectionStatus =
  | 'initializing'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'

export interface WalletAbiRawEnvelope {
  id: number | string
  jsonrpc: string
  method: WalletAbiMethod
  params?: unknown
}

export interface WalletAbiRawSuccessEnvelope {
  id: number | string
  jsonrpc: string
  result: unknown
}

interface WalletAbiContextValue {
  status: WalletConnectionStatus
  error: string | null
  sessionTopic: string | null
  receiveAddress: string | null
  signingXOnlyPubkey: string | null
  identityLoading: boolean
  ready: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  refreshIdentity: () => Promise<void>
  getSignerReceiveAddress: () => Promise<{
    value: string
    response: WalletAbiJsonRpcResponse
  }>
  getRawSigningXOnlyPubkey: () => Promise<{
    value: string
    response: WalletAbiJsonRpcResponse
  }>
  processRequest: (request: WalletAbiTxCreateRequest) => Promise<{
    value: WalletAbiTxCreateResponse
    response: WalletAbiJsonRpcResponse
  }>
  sendRawEnvelope: (envelope: WalletAbiRawEnvelope) => Promise<WalletAbiRawSuccessEnvelope>
}

const WalletAbiContext = createContext<WalletAbiContextValue | null>(null)

const DEFAULT_TIMEOUT_MS = 180_000
const DISCONNECTED_REQUEST_ERROR =
  'Wallet ABI request was dropped because the wallet session disconnected.'
const DUPLICATE_PROCESS_REQUEST_ERROR =
  'A Wallet ABI request is already waiting for wallet approval. Approve, reject, wait for timeout, or disconnect before sending another request.'

type WalletAbiProcessRequestResult = Awaited<ReturnType<WalletAbiContextValue['processRequest']>>

interface WalletAbiSessionBootstrap {
  controller: WalletAbiSessionController
  requester: ReturnType<typeof createRequester>
  client: WalletAbiClient
}

let sessionBootstrapKey: string | null = null
let sessionBootstrapPromise: Promise<WalletAbiSessionBootstrap> | null = null

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return String(error)
}

function normalizeJsonRpcResult(result: unknown): unknown {
  if (typeof result !== 'string') {
    return result
  }

  try {
    return JSON.parse(result)
  } catch {
    return result
  }
}

function createRequester(controller: WalletAbiSessionController) {
  return createWalletConnectRequester({
    chainId: controller.chainId,
    getTopic: () => controller.session()?.topic,
    client: {
      async connect() {
        await controller.connect()
      },
      disconnect: () => controller.disconnect(),
      request: ({ request }) => controller.request(request),
    },
  })
}

function appUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:5173'
  }

  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function sessionBootstrapCacheKey({
  projectId,
  appNetwork,
  storagePrefix,
}: {
  projectId: string
  appNetwork: ReturnType<typeof getWalletAbiTransportNetwork>
  storagePrefix: string
}) {
  return JSON.stringify({
    projectId,
    appNetwork,
    storagePrefix,
    appUrl: appUrl(),
  })
}

function getOrCreateSessionBootstrap({
  projectId,
  appNetwork,
  storagePrefix,
}: {
  projectId: string
  appNetwork: ReturnType<typeof getWalletAbiTransportNetwork>
  storagePrefix: string
}): Promise<WalletAbiSessionBootstrap> {
  const cacheKey = sessionBootstrapCacheKey({
    projectId,
    appNetwork,
    storagePrefix,
  })

  if (sessionBootstrapPromise && sessionBootstrapKey === cacheKey) {
    return sessionBootstrapPromise
  }

  sessionBootstrapKey = cacheKey
  sessionBootstrapPromise = (async () => {
    await loadLwkWalletAbiWeb()
    const controller = await createWalletAbiSessionController({
      projectId,
      network: appNetwork,
      appUrl: appUrl(),
      storagePrefix,
      metadata: {
        name: 'Simplicity Lending',
        description: 'Wallet ABI WalletConnect interface for Simplicity lending flows.',
      },
    })
    const requester = createRequester(controller)
    const client = new WalletAbiClient({
      requester,
      requestTimeoutMs: DEFAULT_TIMEOUT_MS,
    })

    return {
      controller,
      requester,
      client,
    }
  })().catch((error) => {
    if (sessionBootstrapKey === cacheKey) {
      sessionBootstrapKey = null
      sessionBootstrapPromise = null
    }
    throw error
  })

  return sessionBootstrapPromise
}

export function WalletAbiProvider({ children }: { children: React.ReactNode }) {
  const projectId = getWalletConnectProjectId()
  const appNetwork = getWalletAbiTransportNetwork()
  const storagePrefix =
    import.meta.env.VITE_WALLETCONNECT_STORAGE_PREFIX?.trim() || 'simplicity-lending'

  const [status, setStatus] = useState<WalletConnectionStatus>(projectId ? 'initializing' : 'error')
  const [error, setError] = useState<string | null>(
    projectId ? null : 'WalletConnect project id is required.'
  )
  const [ready, setReady] = useState(false)
  const [identityLoading, setIdentityLoading] = useState(false)
  const [sessionTopic, setSessionTopic] = useState<string | null>(null)
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null)
  const [signingXOnlyPubkey, setSigningXOnlyPubkey] = useState<string | null>(null)

  const controllerRef = useRef<WalletAbiSessionController | null>(null)
  const requesterRef = useRef<ReturnType<typeof createRequester> | null>(null)
  const clientRef = useRef<WalletAbiClient | null>(null)
  const connectPromiseRef = useRef<Promise<void> | null>(null)
  const disconnectPromiseRef = useRef<Promise<void> | null>(null)
  const processRequestPromiseRef = useRef<Promise<WalletAbiProcessRequestResult> | null>(null)
  const connectGenerationRef = useRef(0)
  const requestGenerationRef = useRef(0)
  const pendingRequestRejectorsRef = useRef(new Set<(reason: Error) => void>())
  const manualDisconnectRef = useRef(false)
  const rpcIdRef = useRef(0)

  const invalidatePendingRequests = useCallback((message = DISCONNECTED_REQUEST_ERROR) => {
    requestGenerationRef.current += 1
    processRequestPromiseRef.current = null
    setIdentityLoading(false)

    if (pendingRequestRejectorsRef.current.size === 0) {
      return
    }

    const reason = new Error(message)
    for (const reject of pendingRequestRejectorsRef.current) {
      reject(reason)
    }
    pendingRequestRejectorsRef.current.clear()
  }, [])

  const nextRpcId = useCallback(() => {
    rpcIdRef.current += 1
    return rpcIdRef.current
  }, [])

  const ensureRequester = useCallback(() => {
    const requester = requesterRef.current
    if (!requester) {
      throw new Error('Wallet ABI session is not ready yet.')
    }
    return requester
  }, [])

  const refreshIdentity = useCallback(async () => {
    const requester = requesterRef.current
    if (!requester) return

    const requestGeneration = requestGenerationRef.current
    setIdentityLoading(true)
    try {
      const [addressResponse, pubkeyResponse] = await Promise.all([
        requester.request(createGetSignerReceiveAddressRequest(nextRpcId())),
        requester.request(createGetRawSigningXOnlyPubkeyRequest(nextRpcId())),
      ])

      if (requestGeneration !== requestGenerationRef.current) return
      setReceiveAddress(parseGetSignerReceiveAddressResponse(addressResponse))
      setSigningXOnlyPubkey(parseGetRawSigningXOnlyPubkeyResponse(pubkeyResponse))
      setError(null)
    } catch (nextError) {
      if (requestGeneration !== requestGenerationRef.current) return
      setReceiveAddress(null)
      setSigningXOnlyPubkey(null)
      setError(normalizeErrorMessage(nextError))
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        setIdentityLoading(false)
      }
    }
  }, [nextRpcId])

  useEffect(() => {
    if (!projectId) {
      return
    }

    let active = true
    let unsubscribe: (() => void) | null = null

    void (async () => {
      try {
        const { controller, requester, client } = await getOrCreateSessionBootstrap({
          projectId,
          appNetwork,
          storagePrefix,
        })

        if (!active) {
          return
        }

        controllerRef.current = controller
        requesterRef.current = requester
        clientRef.current = client
        setReady(true)
        setSessionTopic(controller.session()?.topic ?? null)
        setStatus(controller.session() ? 'connected' : 'disconnected')
        setError(null)

        unsubscribe = controller.subscribe({
          onConnected: () => {
            if (!active) return
            if (manualDisconnectRef.current) {
              void controller.disconnect()
              return
            }
            setSessionTopic(controller.session()?.topic ?? null)
            setStatus('connected')
            void refreshIdentity()
          },
          onUpdated: () => {
            if (!active) return
            setSessionTopic(controller.session()?.topic ?? null)
          },
          onDisconnected: () => {
            if (!active) return
            invalidatePendingRequests()
            setSessionTopic(null)
            setReceiveAddress(null)
            setSigningXOnlyPubkey(null)
            setStatus('disconnected')
          },
        })

        if (controller.session()) {
          void refreshIdentity()
        }
      } catch (nextError) {
        if (!active) return
        setStatus('error')
        setError(normalizeErrorMessage(nextError))
      }
    })()

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [appNetwork, invalidatePendingRequests, projectId, refreshIdentity, storagePrefix])

  const connect = useCallback(async () => {
    const client = clientRef.current
    const controller = controllerRef.current
    if (!client || !controller) {
      throw new Error('Wallet ABI session is not ready yet.')
    }

    if (controller.session()) {
      setSessionTopic(controller.session()?.topic ?? null)
      setStatus('connected')
      await refreshIdentity()
      return
    }

    if (connectPromiseRef.current) {
      return connectPromiseRef.current
    }

    const promise = (async () => {
      const connectGeneration = ++connectGenerationRef.current
      manualDisconnectRef.current = false
      setStatus('connecting')
      setError(null)
      try {
        await client.connect()
        if (connectGeneration !== connectGenerationRef.current || manualDisconnectRef.current) {
          await client.disconnect().catch(() => undefined)
          await controller.disconnect().catch(() => undefined)
          setReceiveAddress(null)
          setSigningXOnlyPubkey(null)
          setSessionTopic(null)
          setStatus('disconnected')
          return
        }
        setSessionTopic(controller.session()?.topic ?? null)
        setStatus('connected')
        await refreshIdentity()
      } catch (nextError) {
        if (connectGeneration !== connectGenerationRef.current || manualDisconnectRef.current) {
          setReceiveAddress(null)
          setSigningXOnlyPubkey(null)
          setSessionTopic(null)
          setStatus('disconnected')
          return
        }
        setStatus('disconnected')
        setError(normalizeErrorMessage(nextError))
        throw nextError
      } finally {
        connectPromiseRef.current = null
      }
    })()

    connectPromiseRef.current = promise
    return promise
  }, [refreshIdentity])

  const disconnect = useCallback(async () => {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    if (disconnectPromiseRef.current) {
      return disconnectPromiseRef.current
    }

    const promise = (async () => {
      connectGenerationRef.current += 1
      manualDisconnectRef.current = true
      connectPromiseRef.current = null
      invalidatePendingRequests()
      setStatus('disconnecting')
      setError(null)
      try {
        await controller.disconnect()
        await clientRef.current?.disconnect().catch(() => undefined)
        setReceiveAddress(null)
        setSigningXOnlyPubkey(null)
        setSessionTopic(null)
        setStatus('disconnected')
      } catch (nextError) {
        setStatus('error')
        setError(normalizeErrorMessage(nextError))
        throw nextError
      } finally {
        disconnectPromiseRef.current = null
      }
    })()

    disconnectPromiseRef.current = promise
    return promise
  }, [invalidatePendingRequests])

  const callWithEnvelope = useCallback(
    async <T,>(
      request: WalletAbiJsonRpcRequest,
      parse: (response: WalletAbiJsonRpcResponse) => T
    ) => {
      const requester = ensureRequester()
      const controller = controllerRef.current
      if (!controller?.session()) {
        throw new Error('WalletConnect session is not connected.')
      }

      const requestGeneration = requestGenerationRef.current
      let rejectOnInvalidation: (reason: Error) => void = () => undefined
      const invalidated = new Promise<never>((_, reject) => {
        rejectOnInvalidation = reject
      })

      pendingRequestRejectorsRef.current.add(rejectOnInvalidation)
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      const timedOut = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Wallet ABI request timed out after ${String(DEFAULT_TIMEOUT_MS / 1000)} seconds.`
            )
          )
        }, DEFAULT_TIMEOUT_MS)
      })

      try {
        const response = await Promise.race([
          Promise.resolve(requester.request(request)),
          invalidated,
          timedOut,
        ])

        if (requestGeneration !== requestGenerationRef.current || !controllerRef.current?.session()) {
          throw new Error(DISCONNECTED_REQUEST_ERROR)
        }

        return {
          response,
          value: parse(response),
        }
      } finally {
        if (timeoutId != null) {
          clearTimeout(timeoutId)
        }
        pendingRequestRejectorsRef.current.delete(rejectOnInvalidation)
      }
    },
    [ensureRequester]
  )

  const getSignerReceiveAddress = useCallback(
    () =>
      callWithEnvelope(
        createGetSignerReceiveAddressRequest(nextRpcId()),
        parseGetSignerReceiveAddressResponse
      ),
    [callWithEnvelope, nextRpcId]
  )

  const getRawSigningXOnlyPubkey = useCallback(
    () =>
      callWithEnvelope(
        createGetRawSigningXOnlyPubkeyRequest(nextRpcId()),
        parseGetRawSigningXOnlyPubkeyResponse
      ),
    [callWithEnvelope, nextRpcId]
  )

  const processRequest = useCallback(
    (request: WalletAbiTxCreateRequest) => {
      if (processRequestPromiseRef.current != null) {
        return Promise.reject(new Error(DUPLICATE_PROCESS_REQUEST_ERROR))
      }

      const promise = callWithEnvelope(
        createProcessRequest(nextRpcId(), request),
        parseProcessRequestResponse
      ).finally(() => {
        if (processRequestPromiseRef.current === promise) {
          processRequestPromiseRef.current = null
        }
      })

      processRequestPromiseRef.current = promise
      return promise
    },
    [callWithEnvelope, nextRpcId]
  )

  const sendRawEnvelope = useCallback(async (envelope: WalletAbiRawEnvelope) => {
    const controller = controllerRef.current
    if (!controller) {
      throw new Error('Wallet ABI session is not ready yet.')
    }

    await clientRef.current?.connect()
    const result = await controller.request({
      method: envelope.method,
      ...(Object.prototype.hasOwnProperty.call(envelope, 'params')
        ? { params: envelope.params }
        : {}),
    })

    return {
      id: envelope.id,
      jsonrpc: envelope.jsonrpc,
      result: normalizeJsonRpcResult(result),
    }
  }, [])

  const value = useMemo<WalletAbiContextValue>(
    () => ({
      status,
      error,
      sessionTopic,
      receiveAddress,
      signingXOnlyPubkey,
      identityLoading,
      ready,
      connect,
      disconnect,
      refreshIdentity,
      getSignerReceiveAddress,
      getRawSigningXOnlyPubkey,
      processRequest,
      sendRawEnvelope,
    }),
    [
      status,
      error,
      sessionTopic,
      receiveAddress,
      signingXOnlyPubkey,
      identityLoading,
      ready,
      connect,
      disconnect,
      refreshIdentity,
      getSignerReceiveAddress,
      getRawSigningXOnlyPubkey,
      processRequest,
      sendRawEnvelope,
    ]
  )

  return <WalletAbiContext.Provider value={value}>{children}</WalletAbiContext.Provider>
}

export function useWalletAbiSession() {
  const context = useContext(WalletAbiContext)
  if (!context) {
    throw new Error('useWalletAbiSession must be used inside WalletAbiProvider.')
  }
  return context
}
