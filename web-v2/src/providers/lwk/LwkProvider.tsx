import { useEffect, useMemo, useState } from 'react'

import { env } from '@/constants/env'
import { createLwkNetwork, getLwk, type Lwk } from '@/lwk'

import { LwkContext } from './LwkContext'

const network = env.VITE_NETWORK

export function LwkProvider({ children }: { children: React.ReactNode }) {
  const [lwk, setLwk] = useState<Lwk | null>(null)
  useEffect(() => {
    let cancelled = false

    getLwk().then(instance => {
      if (!cancelled) setLwk(instance)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const lwkNetwork = useMemo(() => (lwk ? createLwkNetwork(network, lwk) : null), [lwk])

  useEffect(() => {
    return () => {
      lwkNetwork?.free()
    }
  }, [lwkNetwork])

  if (!lwk || !lwkNetwork) {
    // TODO: Replace with proper loader after UI framework setup
    return <div>Loading...</div>
  }

  return (
    <LwkContext.Provider
      value={{
        lwk,
        lwkNetwork,
        network,
        isTestnet: network === 'liquidtestnet',
        isMainnet: network === 'liquid',
        isRegtest: network === 'regtest',
      }}
    >
      {children}
    </LwkContext.Provider>
  )
}
