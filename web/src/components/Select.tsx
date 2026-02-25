/**
 * Custom dropdown select using formClassNames. Trigger + list (no native <select>).
 * Chevron is inside the trigger; list uses dropdownList/dropdownItem styles.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { formClassNames } from './formClassNames'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (e: { target: { value: string } }) => void
  className?: string
  id?: string
  disabled?: boolean
  /** When true, width follows content (trigger and list); use for long options (e.g. UTXO). */
  adaptiveWidth?: boolean
  /**
   * When true, trigger and list use min-width from the longest option (so no wrapping),
   * capped by maxOptionWidth. Use for short option lists (e.g. mode selector).
   */
  widthFromLongestOption?: boolean
  /** Max width when widthFromLongestOption is true (e.g. '20rem'). Default '20rem'. */
  maxOptionWidth?: string
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

const DEFAULT_MAX_OPTION_WIDTH = '20rem'

export function Select({
  options,
  value,
  onChange,
  className = '',
  id,
  disabled,
  adaptiveWidth,
  widthFromLongestOption,
  maxOptionWidth = DEFAULT_MAX_OPTION_WIDTH,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [measuredMinWidth, setMeasuredMinWidth] = useState<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLLIElement | null)[]>([])
  const measureRefs = useRef<(HTMLSpanElement | null)[]>([])

  // Measure longest option width when widthFromLongestOption (so width is correct before first open)
  useEffect(() => {
    if (!widthFromLongestOption || options.length === 0) return
    const n = options.length
    const id = requestAnimationFrame(() => {
      let max = 0
      for (let i = 0; i < n; i++) {
        const el = measureRefs.current[i]
        if (el) max = Math.max(max, el.getBoundingClientRect().width)
      }
      if (max > 0) setMeasuredMinWidth(max)
    })
    return () => cancelAnimationFrame(id)
  }, [widthFromLongestOption, options])

  // When open, re-measure from actual list items (same as dropdown width)
  useEffect(() => {
    if (!widthFromLongestOption || !open || options.length === 0) return
    const id = requestAnimationFrame(() => {
      let max = 0
      for (let i = 0; i < optionRefs.current.length; i++) {
        const el = optionRefs.current[i]
        if (el) max = Math.max(max, el.scrollWidth)
      }
      if (max > 0) setMeasuredMinWidth(max)
    })
    return () => cancelAnimationFrame(id)
  }, [widthFromLongestOption, open, options.length])

  const selectedOption = options.find((o) => o.value === value)
  const displayLabel = selectedOption ? selectedOption.label : (options[0]?.label ?? '')

  const close = useCallback(() => {
    setOpen(false)
    setHighlightIndex(-1)
  }, [])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, close])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
        setHighlightIndex(options.findIndex((o) => o.value === value))
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => (i < options.length - 1 ? i + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => (i > 0 ? i - 1 : options.length - 1))
    } else if (e.key === 'Enter' && highlightIndex >= 0 && options[highlightIndex]) {
      e.preventDefault()
      onChange({ target: { value: options[highlightIndex].value } })
      close()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  useEffect(() => {
    if (open && highlightIndex >= 0 && optionRefs.current[highlightIndex]) {
      optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlightIndex])

  const useLongestWidth = Boolean(widthFromLongestOption)
  const triggerClass = [
    formClassNames.select,
    'pr-3 flex items-center justify-between text-left cursor-pointer gap-2',
    disabled && 'opacity-50 cursor-not-allowed',
    adaptiveWidth ? 'w-max' : useLongestWidth ? 'w-full' : 'w-full',
  ]
    .filter(Boolean)
    .join(' ')

  const wrapperClass =
    `relative ${adaptiveWidth ? 'w-max max-w-full ' : ''}${useLongestWidth ? 'w-max ' : ''}${className}`.trim()
  const wrapperStyle =
    useLongestWidth && measuredMinWidth > 0
      ? { minWidth: measuredMinWidth, maxWidth: maxOptionWidth }
      : undefined

  return (
    <div ref={containerRef} className={wrapperClass} id={id} style={wrapperStyle}>
      {useLongestWidth && options.length > 0 && (
        <div className="absolute left-0 top-0 invisible pointer-events-none" aria-hidden>
          {options.map((opt, idx) => (
            <span
              key={opt.value}
              ref={(el) => {
                measureRefs.current[idx] = el
              }}
              className={`${formClassNames.dropdownItem} whitespace-nowrap block`}
            >
              {opt.label}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        className={triggerClass}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={displayLabel}
      >
        <span className={adaptiveWidth ? 'min-w-0' : 'truncate'}>{displayLabel}</span>
        <span
          className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <ChevronDown />
        </span>
      </button>
      {open && (
        <ul
          className={`absolute left-0 z-10 ${formClassNames.dropdownList} ${adaptiveWidth || useLongestWidth ? 'min-w-full w-max' : 'right-0'}`}
          role="listbox"
          aria-activedescendant={
            highlightIndex >= 0 && options[highlightIndex]
              ? `option-${options[highlightIndex].value}`
              : undefined
          }
        >
          {options.map((opt, idx) => (
            <li
              key={opt.value}
              ref={(el) => {
                optionRefs.current[idx] = el
              }}
              id={`option-${opt.value}`}
              role="option"
              aria-selected={opt.value === value}
              className={`${formClassNames.dropdownItem} ${adaptiveWidth || useLongestWidth ? 'whitespace-nowrap' : ''} ${idx === highlightIndex ? 'bg-gray-100' : ''}`}
              onMouseEnter={() => setHighlightIndex(idx)}
              onMouseLeave={() => setHighlightIndex(-1)}
              onClick={() => {
                onChange({ target: { value: opt.value } })
                close()
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
