import { useCallback, useEffect, useRef, useState } from 'react'

export function useCopyToClipboard(resetDelayMs = 1500): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof window.setTimeout>>(-1)

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
