import { vi } from 'vitest'

import { HUMID_CONNECTOR } from '@/lib/humid/appkit-injected-adapter'
import {
  createFakeInjectedProvider,
  type FakeInjectedProvider,
} from '@/lib/wallet/humid/fakeProvider'
import { WALLET_NAMESPACE } from '@/lib/wallet/network'

/**
 * The browser facts the connection layer expects and jsdom does not provide.
 *
 * Everything stubbed here is decoration — a colour-scheme query, a wallet-directory fetch, an
 * animation frame. None of it is the wallet: the wallet is the fake injected provider, and what
 * it answers is what the tests turn on.
 */
export function installBrowserEnvironment(): void {
  // React renders into this document, so it is told it is a test renderer and every update is
  // expected to be wrapped — without it every state change warns instead of being awaited.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  // The connection layer asks a hosted directory for wallets it could suggest. There is no
  // network here and no suggestion is wanted: the only wallet these tests connect is injected.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [], count: 0 }), { status: 200 })),
  )
}

/** Put a fake HUMID extension on the page and hand it back for the test to drive. */
export function installFakeExtension(): FakeInjectedProvider {
  const provider = createFakeInjectedProvider()

  window.humid = provider

  return provider
}

/**
 * The browser state a previous connection leaves behind.
 *
 * A reload restores nothing unless the page remembers which wallet it last connected — the keys
 * below are the ones the connection layer writes itself (`SafeLocalStorage`,
 * `getSafeConnectorIdKey`). Writing them here is what makes the next page load a reload rather
 * than a first visit.
 */
export function rememberPreviousConnection(): void {
  localStorage.setItem(`@appkit/${WALLET_NAMESPACE}:connected_connector_id`, HUMID_CONNECTOR.id)
  localStorage.setItem('@appkit/connected_namespaces', WALLET_NAMESPACE)
  localStorage.setItem('@appkit/active_namespace', WALLET_NAMESPACE)
  localStorage.setItem('@appkit/connection_status', 'connected')
}
