import { useCallback, useState } from 'react'

export function useSessionStorage<T>(key: string): [T | null, (value: T | null) => void] {
  const [value, setValueState] = useState<T | null>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  })

  const setValue = useCallback(
    (newValue: T | null) => {
      if (newValue === null) {
        sessionStorage.removeItem(key)
      } else {
        sessionStorage.setItem(key, JSON.stringify(newValue))
      }
      setValueState(newValue)
    },
    [key],
  )

  return [value, setValue]
}
