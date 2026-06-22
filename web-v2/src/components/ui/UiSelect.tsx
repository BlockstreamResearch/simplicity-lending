import {
  Description,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  type ListBoxItemRootProps,
  Select,
  type SelectProps,
} from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiSelectProps extends Omit<
  SelectProps<ListBoxItemRootProps, 'single'>,
  'children' | 'items'
> {
  options: ListBoxItemRootProps[]
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
          {(option: ListBoxItemRootProps) => (
            <ListBoxItem {...option}>{option.textValue}</ListBoxItem>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
