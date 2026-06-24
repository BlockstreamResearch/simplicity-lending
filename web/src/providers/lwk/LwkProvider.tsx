import { Spinner } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'

import { env } from '@/constants/env'
import { createLwkNetwork, getLwk } from '@/lwk'

import { LwkContext } from './LwkContext'

const network = env.VITE_NETWORK
const MIN_LOADER_DURATION_MS = 600

export function LwkProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [showApp, setShowApp] = useState(false)
  const [isContentVisible, setIsContentVisible] = useState(false)

  const [loadStartedAt] = useState(() => Date.now())

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

  useEffect(() => {
    if (!lwkNetwork) return
    const elapsed = Date.now() - loadStartedAt
    const delay = Math.max(0, MIN_LOADER_DURATION_MS - elapsed)
    const timeoutId = setTimeout(() => setShowApp(true), delay)

    return () => clearTimeout(timeoutId)
  }, [lwkNetwork, loadStartedAt])

  useEffect(() => {
    if (!showApp) return
    const id = requestAnimationFrame(() => setIsContentVisible(true))
    return () => cancelAnimationFrame(id)
  }, [showApp])

  if (!lwkNetwork || !showApp) {
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
        className={`transition-opacity duration-300 ${isContentVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        {children}
      </div>
    </LwkContext.Provider>
  )
}
