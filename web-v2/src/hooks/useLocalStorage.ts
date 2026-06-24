import { useCallback, useState } from 'react'

export function useLocalStorage<T extends string>(
  key: string,
  defaultValue: T,
  isValid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValueState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue
    const stored = window.localStorage.getItem(key)
    return isValid(stored) ? stored : defaultValue
  })

  const setValue = useCallback(
    (newValue: T) => {
      window.localStorage.setItem(key, newValue)
      setValueState(newValue)
    },
    [key],
  )

  return [value, setValue]
}
