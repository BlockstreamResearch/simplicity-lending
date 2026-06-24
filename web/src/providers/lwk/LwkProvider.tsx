import { Spinner } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'

import { env } from '@/constants/env'
import { createLwkNetwork, getLwk } from '@/lwk'

import { LwkContext } from './LwkContext'

const network = env.VITE_NETWORK
const MIN_LOADER_DURATION_MS = 600

export function LwkProvider({ children }: { children: React.ReactNode }) {
  const [isLwkReady, setIsLwkReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isLoaderComplete, setIsLoaderComplete] = useState(false)
  const [isContentVisible, setIsContentVisible] = useState(false)

  const [loadStartedAt] = useState(() => Date.now())

  if (error) throw error

  useEffect(() => {
    let cancelled = false

    getLwk()
      .then(() => {
        if (!cancelled) {
          setIsLwkReady(true)
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
    if (!isLwkReady) {
      return null
    }

    return createLwkNetwork(network)
  }, [isLwkReady])

  useEffect(() => {
    return () => {
      lwkNetwork?.free()
    }
  }, [lwkNetwork])

  useEffect(() => {
    if (!lwkNetwork) return

    const elapsed = Date.now() - loadStartedAt
    const delay = Math.max(0, MIN_LOADER_DURATION_MS - elapsed)

    const timeoutId = setTimeout(() => {
      setIsLoaderComplete(true)
    }, delay)

    return () => clearTimeout(timeoutId)
  }, [lwkNetwork, loadStartedAt])

  useEffect(() => {
    if (!isLoaderComplete) return

    const id = requestAnimationFrame(() => {
      setIsContentVisible(true)
    })

    return () => cancelAnimationFrame(id)
  }, [isLoaderComplete])

  if (!lwkNetwork || !isLoaderComplete) {
    return (
      <main className='bg-surface text-foreground flex min-h-screen flex-col items-center justify-center gap-5'>
        <Spinner size='lg' color='accent' />
        <div className='flex flex-col items-center gap-1.5'>
          <h1 className='text-2xl leading-none font-black tracking-tight uppercase'>Lending</h1>
          <p className='text-muted text-xs font-medium tracking-[0.16em] uppercase'>
            Warming up the wallet engine…
          </p>
        </div>
      </main>
    )
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
      <div
        className={`transition-opacity duration-300 ${
          isContentVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {children}
      </div>
    </LwkContext.Provider>
  )
}
