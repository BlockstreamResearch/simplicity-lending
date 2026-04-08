import { UniversalConnector } from '@reown/appkit-universal-connector'
import type { CustomCaipNetwork } from '@reown/appkit-common'
import SignClient from '@walletconnect/sign-client'
import type { SessionTypes, SignClientTypes } from '@walletconnect/types'
import { getSdkError } from '@walletconnect/utils'
import {
  WALLET_ABI_WALLETCONNECT_EVENTS,
  WALLET_ABI_WALLETCONNECT_METHODS,
  WALLET_ABI_WALLETCONNECT_NAMESPACE,
  createWalletAbiRequiredNamespaces,
  walletAbiNetworkToWalletConnectChain,
  type WalletAbiMethod,
  type WalletAbiWalletConnectChain,
} from 'wallet-abi-sdk-alpha'
import type { WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'

const DEFAULT_WALLET_ABI_NETWORK: WalletAbiNetwork = 'testnet-liquid'
const WALLET_ABI_STORAGE_PREFIX = 'simplicity-lending-wallet-abi'
const WALLETCONNECT_USER_DISCONNECTED = getSdkError('USER_DISCONNECTED')
const WALLETCONNECT_APPROVAL_TIMEOUT_MS = 90_000
const WALLETCONNECT_APPROVAL_REJECTION_GRACE_MS = 1_500
const WALLETCONNECT_SESSION_POLL_INTERVAL_MS = 250

export interface WalletAbiWalletConnectRequest {
  method: WalletAbiMethod
  params?: unknown
}

export interface WalletAbiSessionControllerCallbacks {
  onConnected?(): void
  onUpdated?(): void
  onDisconnected?(): void
}

export interface WalletAbiSessionController {
  readonly chainId: WalletAbiWalletConnectChain
  session(): SessionTypes.Struct | null
  connect(): Promise<SessionTypes.Struct>
  disconnect(): Promise<void>
  request(request: WalletAbiWalletConnectRequest): Promise<unknown>
  subscribe(callbacks: WalletAbiSessionControllerCallbacks): () => void
}

export interface CreateWalletAbiSessionControllerOptions {
  projectId: string
  network: WalletAbiNetwork
  appUrl: string
}

export interface SelectedWalletAbiSessions {
  activeSession: SessionTypes.Struct | null
  staleSessions: SessionTypes.Struct[]
}

interface WalletAbiAppKitControls {
  open(options?: { uri?: string }): Promise<void>
  close(): Promise<void>
}

type WalletAbiRequiredNamespaces = Record<
  string,
  {
    methods: string[]
    chains: string[]
    events: string[]
  }
>

export interface WalletAbiSessionApprovalSignClient {
  session: {
    getAll(): SessionTypes.Struct[]
  }
  on(
    event: 'session_connect',
    listener: (event: SignClientTypes.EventArguments['session_connect']) => void
  ): void
  off(
    event: 'session_connect',
    listener: (event: SignClientTypes.EventArguments['session_connect']) => void
  ): void
}

export interface AwaitWalletAbiApprovedSessionOptions {
  approval(): Promise<SessionTypes.Struct>
  signClient: WalletAbiSessionApprovalSignClient
  chainId: WalletAbiWalletConnectChain
  connectTimeoutMs?: number
  approvalRejectionGraceMs?: number
  sessionPollMs?: number
}

const WALLET_ABI_NATIVE_CURRENCY = {
  name: 'Liquid Bitcoin',
  symbol: 'L-BTC',
  decimals: 8,
} as const

function networkName(network: WalletAbiNetwork): string {
  switch (network) {
    case 'liquid':
      return 'Liquid'
    case 'testnet-liquid':
      return 'Liquid Testnet'
    case 'localtest-liquid':
      return 'Liquid Localtest'
  }

  throw new Error(`Unsupported Wallet ABI network: ${String(network)}`)
}

function networkRpcUrl(network: WalletAbiNetwork): string {
  switch (network) {
    case 'liquid':
      return 'https://blockstream.info/liquid/api'
    case 'testnet-liquid':
      return 'https://blockstream.info/liquidtestnet/api'
    case 'localtest-liquid':
      return 'http://127.0.0.1:3001'
  }

  throw new Error(`Unsupported Wallet ABI network: ${String(network)}`)
}

function networkExplorerUrl(network: WalletAbiNetwork): string {
  switch (network) {
    case 'liquid':
      return 'https://blockstream.info/liquid'
    case 'testnet-liquid':
      return 'https://blockstream.info/liquidtestnet'
    case 'localtest-liquid':
      return 'http://127.0.0.1:3001'
  }

  throw new Error(`Unsupported Wallet ABI network: ${String(network)}`)
}

function sessionContainsChain(
  session: SessionTypes.Struct,
  chainId: WalletAbiWalletConnectChain
): boolean {
  const namespace = session.namespaces[WALLET_ABI_WALLETCONNECT_NAMESPACE]
  if (namespace === undefined) {
    return false
  }

  if (namespace.accounts.some((account) => account.startsWith(`${chainId}:`))) {
    return true
  }

  if (namespace.chains?.includes(chainId) === true) {
    return true
  }

  return session.requiredNamespaces[WALLET_ABI_WALLETCONNECT_NAMESPACE]?.chains?.includes(chainId) === true
}

export function resolveWalletAbiNetwork(value: string | undefined): WalletAbiNetwork {
  switch (value) {
    case 'liquid':
    case 'testnet-liquid':
    case 'localtest-liquid':
      return value
    default:
      return DEFAULT_WALLET_ABI_NETWORK
  }
}

export function createWalletAbiCaipNetwork(
  network: WalletAbiNetwork
): CustomCaipNetwork {
  const caipNetworkId = walletAbiNetworkToWalletConnectChain(network)
  const [, chainReference] = caipNetworkId.split(':')
  const rpcUrl = networkRpcUrl(network)

  return {
    id: chainReference,
    name: networkName(network),
    caipNetworkId,
    chainNamespace: WALLET_ABI_WALLETCONNECT_NAMESPACE,
    nativeCurrency: WALLET_ABI_NATIVE_CURRENCY,
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
      public: {
        http: [rpcUrl],
      },
    },
    blockExplorers: {
      default: {
        name: `${networkName(network)} Explorer`,
        url: networkExplorerUrl(network),
      },
    },
    testnet: network !== 'liquid',
  } as unknown as CustomCaipNetwork
}

export function isWalletAbiSession(
  session: SessionTypes.Struct,
  chainId: WalletAbiWalletConnectChain
): boolean {
  const namespace = session.namespaces[WALLET_ABI_WALLETCONNECT_NAMESPACE]
  if (namespace === undefined) {
    return false
  }

  const supportsMethods = WALLET_ABI_WALLETCONNECT_METHODS.every((method) =>
    namespace.methods.includes(method)
  )

  return supportsMethods && sessionContainsChain(session, chainId)
}

export function selectWalletAbiSessions(
  sessions: SessionTypes.Struct[],
  chainId: WalletAbiWalletConnectChain
): SelectedWalletAbiSessions {
  const matchingSessions = sessions
    .filter((session) => isWalletAbiSession(session, chainId))
    .sort((left, right) => right.expiry - left.expiry)

  const [activeSession, ...staleSessions] = matchingSessions
  return {
    activeSession: activeSession ?? null,
    staleSessions,
  }
}

function disconnectSession(signClient: SignClient, topic: string): Promise<void> {
  return signClient
    .disconnect({
      topic,
      reason: WALLETCONNECT_USER_DISCONNECTED,
    })
    .catch(() => undefined)
}

export function createWalletAbiMetadata(appUrl: string) {
  const normalizedUrl = new URL(appUrl)

  return {
    name: 'Simplicity Lending',
    description: 'Wallet ABI WalletConnect session for the Simplicity Lending web app.',
    url: normalizedUrl.toString(),
    icons: [`${normalizedUrl.origin}/vite.svg`],
    redirect: {
      universal: normalizedUrl.toString(),
    },
  }
}

function normalizeRequestParams(params: unknown): object | Record<string, unknown> | unknown[] {
  if (Array.isArray(params)) {
    return params
  }

  if (typeof params === 'object' && params !== null) {
    return params as Record<string, unknown>
  }

  throw new Error('WalletConnect request params must be an object or array')
}

function appKitControls(connector: UniversalConnector): WalletAbiAppKitControls {
  return (connector as unknown as { appKit: WalletAbiAppKitControls }).appKit
}

function describeWalletConnectError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim().length > 0) {
      return message
    }

    try {
      const serialized = JSON.stringify(error)
      if (serialized.length > 0) {
        return serialized
      }
    } catch {
      // Ignore JSON serialization failures and fall back to a generic message.
    }
  }

  return 'Unknown error'
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (result) => {
        clearTimeout(timeoutId)
        resolve(result)
      },
      (error) => {
        clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

function currentWalletAbiSession(
  signClient: WalletAbiSessionApprovalSignClient,
  chainId: WalletAbiWalletConnectChain
): SessionTypes.Struct | null {
  return selectWalletAbiSessions(signClient.session.getAll(), chainId).activeSession
}

function createRequiredNamespaces(
  chainId: WalletAbiWalletConnectChain
): WalletAbiRequiredNamespaces {
  const requiredNamespaces = createWalletAbiRequiredNamespaces(chainId)

  return Object.fromEntries(
    Object.entries(requiredNamespaces).map(([namespace, value]) => [
      namespace,
      {
        methods: [...value.methods],
        chains: [...value.chains],
        events: [...value.events],
      },
    ])
  )
}

export async function awaitWalletAbiApprovedSession({
  approval,
  signClient,
  chainId,
  connectTimeoutMs = WALLETCONNECT_APPROVAL_TIMEOUT_MS,
  approvalRejectionGraceMs = WALLETCONNECT_APPROVAL_REJECTION_GRACE_MS,
  sessionPollMs = WALLETCONNECT_SESSION_POLL_INTERVAL_MS,
}: AwaitWalletAbiApprovedSessionOptions): Promise<SessionTypes.Struct> {
  const existingSession = currentWalletAbiSession(signClient, chainId)
  if (existingSession !== null) {
    return existingSession
  }

  let active = true
  let cleanupListener: (() => void) | null = null

  const stopWaiting = () => {
    if (!active) {
      return
    }

    active = false
    cleanupListener?.()
    cleanupListener = null
  }

  const sessionConnectPromise = new Promise<SessionTypes.Struct>((resolve) => {
    const onConnected = ({
      session,
    }: SignClientTypes.EventArguments['session_connect']) => {
      if (!isWalletAbiSession(session, chainId)) {
        return
      }

      stopWaiting()
      resolve(session)
    }

    cleanupListener = () => {
      signClient.off('session_connect', onConnected)
    }
    signClient.on('session_connect', onConnected)
  })

  const approvalPromise = approval()
    .then((session) => {
      stopWaiting()
      return session
    })
    .catch(async (error) => {
      const deadline = Date.now() + approvalRejectionGraceMs

      while (active && Date.now() < deadline) {
        const nextSession = currentWalletAbiSession(signClient, chainId)
        if (nextSession !== null) {
          stopWaiting()
          return nextSession
        }

        await sleep(sessionPollMs)
      }

      stopWaiting()
      throw error
    })

  try {
    return await withTimeout(
      Promise.race([approvalPromise, sessionConnectPromise]),
      connectTimeoutMs,
      'WalletConnect session approval timed out'
    )
  } finally {
    stopWaiting()
  }
}

class WalletAbiUniversalSessionController implements WalletAbiSessionController {
  readonly chainId: WalletAbiWalletConnectChain
  readonly #connector: UniversalConnector
  readonly #signClient: SignClient
  readonly #requiredNamespaces: WalletAbiRequiredNamespaces
  #session: SessionTypes.Struct | null

  constructor(
    connector: UniversalConnector,
    signClient: SignClient,
    session: SessionTypes.Struct | null,
    chainId: WalletAbiWalletConnectChain,
    requiredNamespaces: WalletAbiRequiredNamespaces
  ) {
    this.#connector = connector
    this.#signClient = signClient
    this.#session = session
    this.chainId = chainId
    this.#requiredNamespaces = requiredNamespaces
  }

  session(): SessionTypes.Struct | null {
    if (this.#session !== null) {
      try {
        const nextSession = this.#signClient.session.get(this.#session.topic)
        this.#session = nextSession
        return nextSession
      } catch {
        this.#session = null
      }
    }

    const { activeSession } = selectWalletAbiSessions(this.#signClient.session.getAll(), this.chainId)
    this.#session = activeSession
    return activeSession
  }

  async connect(): Promise<SessionTypes.Struct> {
    const existingSession = this.session()
    if (existingSession !== null) {
      return existingSession
    }

    const appKit = appKitControls(this.#connector)
    let session: SessionTypes.Struct | undefined
    let modalOpened = false

    try {
      const { uri, approval } = await this.#signClient.connect({
        requiredNamespaces: this.#requiredNamespaces,
      })

      if (uri !== undefined) {
        await appKit.open({ uri })
        modalOpened = true
      }

      session = await awaitWalletAbiApprovedSession({
        approval,
        signClient: this.#signClient,
        chainId: this.chainId,
      })
      this.#session = session
    } catch (error) {
      throw new Error(`Error connecting to wallet: ${describeWalletConnectError(error)}`)
    } finally {
      if (modalOpened) {
        await appKit.close().catch(() => undefined)
      }
    }

    if (session === undefined) {
      throw new Error('Error connecting to wallet: No session found')
    }

    await this.#disconnectExtraSessions(session.topic)
    return session
  }

  async disconnect(): Promise<void> {
    const session = this.session()
    if (session === null) {
      return
    }

    this.#session = null
    await disconnectSession(this.#signClient, session.topic)
  }

  request(request: WalletAbiWalletConnectRequest): Promise<unknown> {
    const session = this.session()
    if (session === null) {
      throw new Error('WalletConnect session is not connected')
    }

    return this.#signClient.request({
      topic: session.topic,
      chainId: this.chainId,
      request: {
        method: request.method,
        params:
          request.params === undefined ? undefined : normalizeRequestParams(request.params),
      },
    })
  }

  subscribe(callbacks: WalletAbiSessionControllerCallbacks): () => void {
    const onConnected = ({ session }: SignClientTypes.EventArguments['session_connect']) => {
      if (!isWalletAbiSession(session, this.chainId)) {
        return
      }

      this.#session = session
      callbacks.onConnected?.()
    }
    const onUpdated = ({ topic }: SignClientTypes.EventArguments['session_update']) => {
      if (this.#session?.topic !== topic) {
        return
      }

      try {
        this.#session = this.#signClient.session.get(topic)
      } catch {
        this.#session = null
        callbacks.onDisconnected?.()
        return
      }

      callbacks.onUpdated?.()
    }
    const onDisconnected = ({ topic }: { topic: string }) => {
      if (this.#session?.topic !== topic) {
        return
      }

      this.#session = null
      callbacks.onDisconnected?.()
    }

    this.#signClient.on('session_connect', onConnected)
    this.#signClient.on('session_update', onUpdated)
    this.#signClient.on('session_delete', onDisconnected)
    this.#signClient.on('session_expire', onDisconnected)

    return () => {
      this.#signClient.off('session_connect', onConnected)
      this.#signClient.off('session_update', onUpdated)
      this.#signClient.off('session_delete', onDisconnected)
      this.#signClient.off('session_expire', onDisconnected)
    }
  }

  async #disconnectExtraSessions(activeTopic: string): Promise<void> {
    const extraSessions = this.#signClient.session
      .getAll()
      .filter((session) => session.topic !== activeTopic && isWalletAbiSession(session, this.chainId))

    await Promise.all(extraSessions.map((session) => disconnectSession(this.#signClient, session.topic)))
  }
}

export async function createWalletAbiSessionController({
  projectId,
  network,
  appUrl,
}: CreateWalletAbiSessionControllerOptions): Promise<WalletAbiSessionController> {
  const metadata = createWalletAbiMetadata(appUrl)
  const chainId = walletAbiNetworkToWalletConnectChain(network)
  const caipNetwork = createWalletAbiCaipNetwork(network)
  const requiredNamespaces = createRequiredNamespaces(chainId)
  const signClient = await SignClient.init({
    projectId,
    metadata,
    customStoragePrefix: WALLET_ABI_STORAGE_PREFIX,
  })

  const { activeSession, staleSessions } = selectWalletAbiSessions(signClient.session.getAll(), chainId)
  await Promise.all(staleSessions.map((session) => disconnectSession(signClient, session.topic)))

  const connector = await UniversalConnector.init({
    projectId,
    metadata,
    networks: [
      {
        namespace: WALLET_ABI_WALLETCONNECT_NAMESPACE,
        chains: [caipNetwork],
        methods: [...WALLET_ABI_WALLETCONNECT_METHODS],
        events: [...WALLET_ABI_WALLETCONNECT_EVENTS],
      },
    ],
    modalConfig: {
      themeMode: 'light',
    },
    providerConfig: {
      client: signClient,
      ...(activeSession === null ? {} : { session: activeSession }),
    },
  })

  return new WalletAbiUniversalSessionController(
    connector,
    signClient,
    activeSession,
    chainId,
    requiredNamespaces
  )
}
