/**
 * Info icon (?) that shows a tooltip on hover only. Uses formClassNames.tooltip.
 */

import { useState } from 'react'
import { formClassNames } from './formClassNames'

export interface InfoTooltipProps {
  content: React.ReactNode
  /** Accessible label for the trigger. */
  'aria-label'?: string
  className?: string
  /** Optional class for the tooltip content box (overrides default formClassNames.tooltip). */
  contentClassName?: string
}

export function InfoTooltip({
  content,
  'aria-label': ariaLabel,
  className = '',
  contentClassName,
}: InfoTooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={`relative inline-flex ${className}`.trim()}>
      <button
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-1"
        aria-label={ariaLabel ?? 'More information'}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        <span className="text-xs font-medium">?</span>
      </button>
      {visible && (
        <div
          className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-normal"
          role="tooltip"
        >
          <div className={`${formClassNames.tooltip} ${contentClassName ?? ''}`.trim()}>
            {content}
          </div>
        </div>
      )}
    </div>
  )
}
