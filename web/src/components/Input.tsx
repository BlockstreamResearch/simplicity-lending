/**
 * Styled input using formClassNames. Optional right suffix (e.g. "LBTC", "USDT").
 */

import type { InputHTMLAttributes } from 'react'
import { formClassNames } from './formClassNames'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional unit/suffix shown on the right inside the border (e.g. "LBTC"). */
  suffix?: string
  /** Slightly reduced height (py-1.5). */
  compact?: boolean
}

const numberNoSpin =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

export function Input({ suffix, compact, className = '', type, ...props }: InputProps) {
  const baseClass = formClassNames.input
  const fieldClass = formClassNames.inputWithSuffixField
  const suffixClass = formClassNames.inputSuffix
  const wrapperClass = formClassNames.inputWithSuffixWrapper
  const padClass = compact ? formClassNames.inputCompactPadding : ''
  const suffixPadClass = compact ? formClassNames.inputSuffixCompactPadding : ''
  const noSpinClass = type === 'number' ? numberNoSpin : ''

  if (suffix != null && suffix !== '') {
    return (
      <div className={`${wrapperClass} ${className}`.trim()}>
        <input
          type={type}
          className={`${fieldClass} ${padClass} ${noSpinClass}`.trim()}
          {...props}
        />
        <span className={`${suffixClass} ${suffixPadClass}`.trim()}>{suffix}</span>
      </div>
    )
  }

  return (
    <input
      type={type}
      className={`${baseClass} ${padClass} ${noSpinClass} ${className}`.trim()}
      {...props}
    />
  )
}
