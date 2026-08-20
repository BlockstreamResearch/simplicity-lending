import { createAppKit } from '@reown/appkit/react'

import { env } from '@/constants/env'
import { HumidAdapter } from '@/lib/humid/appkit-injected-adapter'
import {
  WALLET_CHAIN,
  WALLET_CHAIN_ID,
  WALLET_CHAINS,
  WALLET_NAMESPACE,
} from '@/lib/wallet/network'

/**
 * The one Liquid chain this connection speaks for, taken from `VITE_NETWORK`.
 *
 * Null on a build the wallet has no chain for; the facade refuses to connect there rather than
 * quietly offering a chain nobody asked for.
 */
export const HUMID_NETWORK = WALLET_CHAIN

/** CAIP-2 id of {@link HUMID_NETWORK}: the scope every wallet call is made in. */
export const HUMID_CHAIN_ID = WALLET_CHAIN_ID

/** The CAIP-2 namespace Liquid shares with Bitcoin. AppKit keys accounts and views by it. */
export const HUMID_NAMESPACE = WALLET_NAMESPACE

/**
 * The one AppKit instance, created when this module is first imported.
 *
 * Initialising at import time is what the AppKit React hooks require: they read a modal that has
 * to already exist, so a provider creating it in an effect would render its first pass against
 * nothing. The facade's humid adapter is the only thing that drives it.
 *
 * Exactly one chain is registered, and which one it is comes from `VITE_NETWORK` — see
 * `lib/wallet/network.ts` for why the count matters more than the choice.
 */
export const appKit = createAppKit({
  adapters: [new HumidAdapter({ networks: WALLET_CHAINS })],
  networks: WALLET_CHAINS,
  projectId: env.VITE_REOWN_PROJECT_ID,
  metadata: {
    name: 'Simplicity Lending',
    description: 'Borrow and lend on Liquid with Simplicity covenants',
    url: window.location.origin,
    icons: [`${window.location.origin}/favicon.svg`],
  },
  // Restores a session the wallet still holds for this origin, so a reload keeps showing the
  // account rather than asking for it again. The read behind it never prompts.
  enableReconnect: true,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
})
