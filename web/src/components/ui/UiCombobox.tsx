import {
  ComboBox,
  type ComboBoxProps,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  type ListBoxItemRootProps,
} from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiComboboxProps extends Omit<ComboBoxProps<ListBoxItemRootProps>, 'children'> {
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
}

export function UiCombobox({
  label,
  placeholder,
  description,
  errorMessage,
  isInvalid,
  ...props
}: UiComboboxProps) {
  const invalid = isInvalid ?? Boolean(errorMessage)

  return (
    <ComboBox isInvalid={invalid} {...props}>
      {label && <Label>{label}</Label>}
      <ComboBox.InputGroup>
        <Input placeholder={placeholder} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      {description && !invalid && <Description>{description}</Description>}
      {invalid && errorMessage && <FieldError>{errorMessage}</FieldError>}
      <ComboBox.Popover>
        <ListBox<ListBoxItemRootProps>>
          {(option: ListBoxItemRootProps) => (
            <ListBoxItem {...option}>{option.textValue}</ListBoxItem>
          )}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
