import { useState } from 'react'
import { SeedContext } from './SeedContext'
import { parseSeedHex, deriveSecretKeyFromIndex } from './utility/seed'
import { Input } from './components/Input'

function normalizeSeedInput(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '')
}

function randomSeedHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

type Props = {
  seedHex: string | null
  setSeedHex: (hex: string) => void
  accountIndex: number
  children: React.ReactNode
}

export function SeedGate({ seedHex, setSeedHex, accountIndex, children }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [displayedGeneratedSeed, setDisplayedGeneratedSeed] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const faucetUrl = import.meta.env.VITE_FAUCET_URL?.trim()

  const handleRandomSeed = () => {
    const hex = randomSeedHex()
    setError(null)
    setInputValue(hex)
    setDisplayedGeneratedSeed(hex)
    setCopyFeedback(false)
  }

  const handleSeedInputChange = (value: string) => {
    setInputValue(value)
    const normalized = normalizeSeedInput(value)
    setDisplayedGeneratedSeed((prev) =>
      prev !== null && normalized === prev ? prev : null
    )
    setCopyFeedback(false)
  }

  const handleCopyGeneratedSeed = async () => {
    if (!displayedGeneratedSeed) return
    try {
      await navigator.clipboard.writeText(displayedGeneratedSeed)
      setCopyFeedback(true)
      window.setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      setCopyFeedback(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const trimmed = normalizeSeedInput(inputValue)
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
          <div className="mb-4 flex w-full max-w-md flex-col gap-3">
            <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 justify-center">
              <Input
                type="password"
                inputMode="text"
                autoComplete="off"
                placeholder="SEED_HEX"
                value={inputValue}
                onChange={(e) => handleSeedInputChange(e.target.value)}
                className="min-w-0 flex-1 font-mono"
              />
              <button type="submit">Continue</button>
            </form>
            <button
              type="button"
              onClick={handleRandomSeed}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Generate random seed
            </button>
          </div>
          {displayedGeneratedSeed ? (
            <div className="mb-4 w-full max-w-md rounded-xl border border-gray-200 bg-gray-50 p-4 text-left shadow-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Generated seed (copy and keep private)
              </p>
              <code className="mb-3 block break-all font-mono text-sm leading-relaxed text-gray-900">
                {displayedGeneratedSeed}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyGeneratedSeed()}
                className="rounded-lg bg-[#5F3DC4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#4f36a8]"
              >
                {copyFeedback ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : null}
          {faucetUrl ? (
            <p className="mb-4 text-sm text-gray-600">
              Need test coins?{' '}
              <a
                href={faucetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-indigo-600 underline hover:text-indigo-800"
              >
                Open Liquid testnet faucet
              </a>
            </p>
          ) : null}
          {error && <p className="text-red-700 bg-red-50 p-4 rounded-lg">{error}</p>}
          <p className="text-gray-500 text-sm mt-4 max-w-md">
            Only for testing. No real wallet yet. Seed is stored in your browser (localStorage) for this
            demo.
          </p>
        </div>
      </div>
    )
  }

  const seedBytes = parseSeedHex(seedHex)
  const getCurrentSecretKey = () => deriveSecretKeyFromIndex(seedBytes, accountIndex)
  return (
    <SeedContext.Provider value={{ seedHex, accountIndex, getCurrentSecretKey }}>
      {children}
    </SeedContext.Provider>
  )
}
