import { useState } from 'react'
import { SeedContext } from './SeedContext'
import { parseSeedHex, deriveSecretKeyFromIndex } from './utility/seed'

type Props = {
  seedHex: string | null
  setSeedHex: (hex: string) => void
  accountIndex: number
  children: React.ReactNode
}

export function SeedGate({ seedHex, setSeedHex, accountIndex, children }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const trimmed = inputValue.trim().toLowerCase().replace(/^0x/, '')
      parseSeedHex(trimmed)
      setSeedHex(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (seedHex === null) {
    return (
      <div className="w-full flex-1 flex items-center justify-center">
        <div className="w-full max-w-7xl px-8 flex flex-col items-center text-center">
          <p className="text-gray-600 mb-6">Demo signer: enter SEED_HEX (32 bytes, 64 hex chars)</p>
          <form onSubmit={handleSubmit} className="flex gap-3 mb-4 w-full max-w-md justify-center">
            <input
              type="password"
              inputMode="text"
              autoComplete="off"
              placeholder="SEED_HEX"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 font-mono text-sm border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
            />
            <button type="submit">Continue</button>
          </form>
          {error && <p className="text-red-700 bg-red-50 p-4 rounded-lg">{error}</p>}
          <p className="text-gray-500 text-sm mt-4 max-w-md">
            Only for testing. No real wallet yet. Seed is not persisted.
          </p>
        </div>
      </div>
    )
  }

  const seedBytes = parseSeedHex(seedHex)
  const getCurrentSecretKey = () => deriveSecretKeyFromIndex(seedBytes, accountIndex)
  return (
    <SeedContext.Provider
      value={{ seedHex, accountIndex, getCurrentSecretKey }}
    >
      {children}
    </SeedContext.Provider>
  )
}
