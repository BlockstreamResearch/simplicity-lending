import { createContext, useContext } from 'react'

export const SeedContext = createContext<{ seedHex: string | null }>({ seedHex: null })

export function useSeedHex(): string | null {
  return useContext(SeedContext).seedHex
}
