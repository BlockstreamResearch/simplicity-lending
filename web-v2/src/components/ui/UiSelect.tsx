import {
  Description,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Select,
  type SelectProps,
} from '@heroui/react'
import type { ReactNode } from 'react'

export type UiSelectKey = string | number

export interface UiSelectOption {
  id: UiSelectKey
  label: string
  isDisabled?: boolean
}

export interface UiSelectProps extends Omit<
  SelectProps<UiSelectOption, 'single'>,
  'children' | 'items'
> {
  options: UiSelectOption[]
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
}

export function UiSelect({
  options,
  label,
  placeholder,
  description,
  errorMessage,
  isInvalid,
  ...props
}: UiSelectProps) {
  const invalid = isInvalid ?? Boolean(errorMessage)

  return (
    <Select isInvalid={invalid} {...props}>
      {label && <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value>
          {({ defaultChildren, isPlaceholder }) => (isPlaceholder ? placeholder : defaultChildren)}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      {description && !invalid && <Description>{description}</Description>}
      {invalid && errorMessage && <FieldError>{errorMessage}</FieldError>}
      <Select.Popover>
        <ListBox items={options}>
          {(option: UiSelectOption) => (
            <ListBoxItem id={option.id} textValue={option.label} isDisabled={option.isDisabled}>
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
