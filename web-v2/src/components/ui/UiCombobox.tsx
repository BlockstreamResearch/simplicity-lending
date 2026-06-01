import {
  ComboBox,
  type ComboBoxProps,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
} from '@heroui/react'
import type { ReactNode } from 'react'

import type { UiSelectOption } from './UiSelect'

export interface UiComboboxProps extends Omit<ComboBoxProps<UiSelectOption>, 'children'> {
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
}

const renderOption = (option: UiSelectOption) => (
  <ListBoxItem id={option.id} textValue={option.label} isDisabled={option.isDisabled}>
    {option.label}
  </ListBoxItem>
)

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
        <ListBox<UiSelectOption>>{renderOption}</ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
