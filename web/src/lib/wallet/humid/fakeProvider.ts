import {
  LIQUID_TESTNET_CHAIN_ID,
  type RawInjectedProvider,
} from '@/lib/humid/appkit-injected-adapter'

/**
 * A stand-in for the extension's injected provider, for tests.
 *
 * It answers the two calls the connection actually turns on — `wallet_createSession`, which is
 * what opens the approval, and `wallet_getSession`, which is what a reload reads — and records
 * everything it was asked. It is not the extension: nothing here checks a permission, shows a
 * window, or holds a key. What it proves is that this dapp asks the right thing and does the
 * right thing with the answer.
 */

export const FAKE_ACCOUNT = 'fcb53a1000000000000000000000000000006a34'

/**
 * A descriptor shaped like the one the wallet approves. It is not derived from and nothing here
 * builds an address out of it — the chain library that would is a WebAssembly module and this is
 * not a browser, so the tests that need an address stand the derivation in.
 */
export const FAKE_DESCRIPTOR = 'elwpkh([00000000/84h/1h/0h]tpub/<0;1>/*)'

export interface FakeInjectedProvider extends RawInjectedProvider {
  /** Every `method` this provider was asked for, in order. */
  readonly calls: string[]
  /** Make the next `wallet_createSession` fail, the way a refused approval does. */
  refuseNextSession(reason: string): void
  /** Make `wallet_createSession` never settle, the way a window nobody answers does. */
  hangNextSession(): void
  /** Start out already holding a session for this origin, as a reload finds. */
  grantExistingSession(): void
  /** What this account holds, keyed by the qualified asset id the wallet names it with. */
  holds(assetId: string, balance: string): void
  /** The outputs this account holds in one asset, as the wallet lists them. */
  holdsUtxos(assetId: string, utxos: { amount: string; confidential: boolean }[]): void
  /** Make every balance read fail, the way a wallet that will not share one does. */
  refuseBalances(reason: string): void
  /** The asset ids `getBalance` was asked for, in order, exactly as they arrived. */
  readonly balanceAsks: string[]
  /** What `processConfidentialTransaction` answers with, in place of performing anything. */
  performsAction(result: unknown): void
  /** Make every action fail, the way a wallet that refused or was dismissed does. */
  refuseActions(reason: string): void
  /** Every action request this provider was asked with, in order, exactly as it arrived. */
  readonly actionRequests: unknown[]
  /** Fire one of the wallet's own events at whoever subscribed. */
  emit(event: string, payload?: unknown): void
}

const SCOPE = LIQUID_TESTNET_CHAIN_ID

function sessionScopes(account: string | null) {
  if (account === null) return {}

  return {
    [SCOPE]: {
      accounts: [`${SCOPE}:${account}`],
      methods: ['getBalance', 'getUTXOs', 'processConfidentialTransaction'],
      notifications: [],
    },
  }
}

export function createFakeInjectedProvider(account = FAKE_ACCOUNT): FakeInjectedProvider {
  const calls: string[] = []
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  let granted: string | null = null
  let refusal: string | null = null
  let hang = false
  let balanceRefusal: string | null = null
  const balances = new Map<string, string>()
  const utxos = new Map<string, { amount: string; confidential: boolean }[]>()
  const balanceAsks: string[] = []
  let actionRefusal: string | null = null
  let actionResult: unknown = undefined
  const actionRequests: unknown[] = []

  /*
   * The shape the wallet validates an asset id against before it does anything else, copied from
   * its own schema. A fake that accepts anything cannot fail the way the wallet fails, and a bare
   * identifier reaching it is exactly the failure this reproduces.
   */
  const QUALIFIED_ASSET_ID = /^bip122:[0-9a-f]{32}\/elip144:[0-9a-f]{64}$/u

  const provider: FakeInjectedProvider = {
    calls,
    refuseNextSession(reason: string) {
      refusal = reason
    },
    hangNextSession() {
      hang = true
    },
    grantExistingSession() {
      granted = account
    },
    balanceAsks,
    holds(assetId: string, balance: string) {
      balances.set(assetId, balance)
    },
    holdsUtxos(assetId: string, held: { amount: string; confidential: boolean }[]) {
      utxos.set(assetId, held)
    },
    refuseBalances(reason: string) {
      balanceRefusal = reason
    },
    actionRequests,
    performsAction(result: unknown) {
      actionResult = result
    },
    refuseActions(reason: string) {
      actionRefusal = reason
    },
    emit(event: string, payload?: unknown) {
      listeners.get(event)?.forEach(listener => listener(payload))
    },
    on({ event, listener }) {
      const forEvent = listeners.get(event) ?? new Set()

      forEvent.add(listener)
      listeners.set(event, forEvent)

      return () => forEvent.delete(listener)
    },
    request<T>({ method, params }: { method: string; params?: unknown }): Promise<T> {
      calls.push(method)

      if (method === 'wallet_invokeMethod') {
        const request = (params as { request?: { method?: string; params?: unknown } } | undefined)
          ?.request
        if (request?.method === 'getWalletDescriptor') {
          return Promise.resolve({
            descriptors: [
              {
                // As the wallet answers: it serves no confidential form, and says so.
                canDeriveConfidentialAddresses: false,
                canDeriveScriptPubKeys: true,
                descriptor: FAKE_DESCRIPTOR,
              },
            ],
          } as T)
        }

        if (request?.method === 'getBalance') {
          const assetId = (request.params as { assetId?: string } | undefined)?.assetId ?? ''

          balanceAsks.push(assetId)

          if (balanceRefusal !== null) return Promise.reject(new Error(balanceRefusal))

          if (!QUALIFIED_ASSET_ID.test(assetId)) {
            return Promise.reject(new Error('Invalid Liquid ELIP-0144 asset ID.'))
          }

          return Promise.resolve({ assetId, balance: balances.get(assetId) ?? '0' } as T)
        }

        if (request?.method === 'getUTXOs') {
          const assetId = (request.params as { assetId?: string } | undefined)?.assetId ?? ''

          return Promise.resolve({
            assetId,
            utxos: (utxos.get(assetId) ?? []).map((held, index) => ({
              address: 'tex1q_fake',
              amount: held.amount,
              assetId,
              confidential: held.confidential,
              scriptPubKey: '0014' + '11'.repeat(20),
              spendable: true,
              txid: String(index).repeat(64).slice(0, 64),
              txOut: '00',
              vout: index,
            })),
          } as T)
        }

        if (request?.method === 'processConfidentialTransaction') {
          actionRequests.push(request.params)

          if (actionRefusal !== null) return Promise.reject(new Error(actionRefusal))

          return Promise.resolve(actionResult as T)
        }
      }

      switch (method) {
        case 'wallet_createSession': {
          if (hang) {
            hang = false

            return new Promise<T>(() => {})
          }

          if (refusal !== null) {
            const reason = refusal

            refusal = null

            return Promise.reject(new Error(reason))
          }

          granted = account

          return Promise.resolve({ sessionScopes: sessionScopes(granted) } as T)
        }
        case 'wallet_getSession':
          return Promise.resolve({ sessionScopes: sessionScopes(granted) } as T)
        case 'wallet_revokeSession':
          granted = null

          return Promise.resolve({ revoked: true } as T)
        case 'wallet_invokeMethod':
          return Promise.resolve(undefined as T)
        default:
          return Promise.reject(new Error(`The fake wallet does not answer ${method}.`))
      }
    },
  }

  return provider
}
