import { useMemo, useState } from 'react'

import { env } from '@/constants/env'
import { createLwkNetwork, getLwk, type NetworkName } from '@/simplicity/lwk'

import { NetworkContext } from './NetworkContext'
import type { NetworkContextValue } from './types'

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<NetworkName>(env.VITE_NETWORK ?? 'liquidtestnet')

  const value = useMemo<NetworkContextValue>(
    () => ({
      network,
      isTestnet: network === 'liquidtestnet',
      isMainnet: network === 'liquid',
      isRegtest: network === 'regtest',
      setNetwork: setNetwork,
      initLwkNetworkInstance: async () => createLwkNetwork(network, await getLwk()),
    }),
    [network],
  )

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}
