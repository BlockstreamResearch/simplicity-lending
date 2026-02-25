/**
 * Styled input using formClassNames. Optional right suffix (e.g. "LBTC", "USDT").
 */

import type { InputHTMLAttributes } from 'react'
import { formClassNames } from './formClassNames'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional unit/suffix shown on the right inside the border (e.g. "LBTC"). */
  suffix?: string
}

export function Input({ suffix, className = '', ...props }: InputProps) {
  const baseClass = formClassNames.input
  const fieldClass = formClassNames.inputWithSuffixField
  const suffixClass = formClassNames.inputSuffix
  const wrapperClass = formClassNames.inputWithSuffixWrapper

  if (suffix != null && suffix !== '') {
    return (
      <div className={`${wrapperClass} ${className}`.trim()}>
        <input className={fieldClass} {...props} />
        <span className={suffixClass}>{suffix}</span>
      </div>
    )
  }

  return <input className={`${baseClass} ${className}`.trim()} {...props} />
}
