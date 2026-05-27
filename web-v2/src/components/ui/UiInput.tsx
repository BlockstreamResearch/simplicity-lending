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

export interface UiInputProps extends Omit<TextFieldProps, 'children'> {
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
  startContent?: ReactNode
  endContent?: ReactNode
}

export function UiInput({
  label,
  placeholder,
  description,
  errorMessage,
  isInvalid,
  startContent,
  endContent,
  ...props
}: UiInputProps) {
  const invalid = isInvalid ?? Boolean(errorMessage)
  const hasGroup = Boolean(startContent || endContent)

  return (
    <TextField isInvalid={invalid} {...props}>
      {label && <Label>{label}</Label>}
      {hasGroup ? (
        <InputGroup>
          {startContent && <InputGroup.Prefix>{startContent}</InputGroup.Prefix>}
          <InputGroup.Input placeholder={placeholder} />
          {endContent && <InputGroup.Suffix>{endContent}</InputGroup.Suffix>}
        </InputGroup>
      ) : (
        <Input placeholder={placeholder} />
      )}
      {description && !invalid && <Description>{description}</Description>}
      {invalid && errorMessage && <FieldError>{errorMessage}</FieldError>}
    </TextField>
  )
}
