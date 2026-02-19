import { useState } from 'react'
import { SeedContext } from './SeedContext'
import { parseSeedHex } from './utility/seed'
import './App.css'

type Props = { children: React.ReactNode }

export function SeedGate({ children }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [seedHex, setSeedHex] = useState<string | null>(null)

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
      <div className="page seed-gate">
        <h1>Simplicity Lending</h1>
        <p className="subtitle">Demo signer: enter SEED_HEX (32 bytes, 64 hex chars)</p>
        <form onSubmit={handleSubmit} className="seed-form">
          <input
            type="password"
            inputMode="text"
            autoComplete="off"
            placeholder="SEED_HEX"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="seed-input"
          />
          <button type="submit" className="seed-submit">
            Вперёд
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <p className="seed-hint">Only for testing. No real wallet yet. Seed is not persisted.</p>
      </div>
    )
  }

  return <SeedContext.Provider value={{ seedHex }}>{children}</SeedContext.Provider>
}
