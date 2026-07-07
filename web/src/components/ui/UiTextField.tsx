import {
  Description,
  FieldError,
  Input,
  InputGroup,
  Label,
  TextField,
  type TextFieldProps,
} from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiTextFieldProps extends Omit<TextFieldProps, 'children'> {
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
  startContent?: ReactNode
  endContent?: ReactNode
  onMax?: () => void
  isMaxDisabled?: boolean
}

export function UiTextField({
  label,
  placeholder,
  description,
  errorMessage,
  isInvalid,
  startContent,
  endContent,
  onMax,
  isMaxDisabled,
  ...props
}: UiTextFieldProps) {
  const invalid = isInvalid ?? Boolean(errorMessage)
  const hasGroup = Boolean(startContent || endContent || onMax)

  return (
    <TextField isInvalid={invalid} {...props}>
      {label && <Label>{label}</Label>}
      {hasGroup ? (
        <InputGroup>
          {startContent && <InputGroup.Prefix>{startContent}</InputGroup.Prefix>}
          <InputGroup.Input placeholder={placeholder} />
          {onMax && (
            <button
              type='button'
              onClick={onMax}
              disabled={isMaxDisabled}
              className='text-muted cursor-pointer pr-3 text-sm font-medium underline disabled:cursor-default disabled:opacity-50'
            >
              MAX
            </button>
          )}
          {endContent && (
            <>
              <div className='w-px shrink-0 self-stretch bg-separator' />
              <InputGroup.Suffix>{endContent}</InputGroup.Suffix>
            </>
          )}
        </InputGroup>
      ) : (
        <Input placeholder={placeholder} />
      )}
      {description && !invalid && <Description>{description}</Description>}
      {invalid && errorMessage && <FieldError>{errorMessage}</FieldError>}
    </TextField>
  )
}
