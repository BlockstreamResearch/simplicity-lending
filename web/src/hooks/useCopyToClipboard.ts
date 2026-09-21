import { useCallback, useEffect, useRef, useState } from 'react'

export function useCopyToClipboard(resetDelayMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  // Left unset rather than seeded with a sentinel id: AppKit's dependencies pull Node's
  // ambient types into this program, where a timer handle is an object and no number is a
  // valid one. `clearTimeout` accepts nothing in both worlds, so this spells the same thing
  // in either.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true)
          clearTimeout(timeoutRef.current)
          timeoutRef.current = setTimeout(() => setCopied(false), resetDelayMs)
        })
        .catch(console.warn)
    },
    [resetDelayMs],
  )

  return [copied, copy]
}
