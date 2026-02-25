/**
 * Info icon (?) that shows a tooltip on hover/focus. Uses formClassNames.tooltip.
 */

import { useState, useRef, useEffect } from 'react'
import { formClassNames } from './formClassNames'

export interface InfoTooltipProps {
  content: React.ReactNode
  /** Accessible label for the trigger. */
  'aria-label'?: string
  className?: string
}

export function InfoTooltip({
  content,
  'aria-label': ariaLabel,
  className = '',
}: InfoTooltipProps) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setVisible(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [visible])

  return (
    <div className={`relative inline-flex ${className}`.trim()} ref={ref}>
      <button
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#5F3DC4] focus:ring-offset-1"
        aria-label={ariaLabel ?? 'More information'}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible((v) => !v)}
      >
        <span className="text-xs font-medium">?</span>
      </button>
      {visible && (
        <div
          className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-normal"
          role="tooltip"
        >
          <div className={formClassNames.tooltip}>{content}</div>
        </div>
      )}
    </div>
  )
}
