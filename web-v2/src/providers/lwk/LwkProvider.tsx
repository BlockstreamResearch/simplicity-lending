import { useEffect, useMemo, useState } from 'react'

import { env } from '@/constants/env'
import { createLwkNetwork, getLwk } from '@/lwk'

import { LwkContext } from './LwkContext'

const network = env.VITE_NETWORK

export function LwkProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  if (error) throw error

  useEffect(() => {
    let cancelled = false

    getLwk()
      .then(() => {
        if (!cancelled) {
          setIsReady(true)
        }
      })
      .catch(err => {
        setError(new Error('Failed to load LWK', { cause: err }))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const lwkNetwork = useMemo(() => {
    if (!isReady) {
      return null
    }

    return createLwkNetwork(network)
  }, [isReady])

  useEffect(() => {
    return () => {
      lwkNetwork?.free()
    }
  }, [lwkNetwork])

  if (!lwkNetwork) {
    // TODO: Replace with proper loader after UI framework setup
    return <div>Loading...</div>
  }

  return (
    <LwkContext.Provider
      value={{
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
