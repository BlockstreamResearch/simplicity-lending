import {
  ComboBox,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Select,
} from '@heroui/react'
import type { ReactNode } from 'react'

export type UiSelectKey = string | number

export interface UiSelectOption {
  id: UiSelectKey
  label: string
  isDisabled?: boolean
}

export interface UiSelectProps {
  options: UiSelectOption[]
  label?: ReactNode
  placeholder?: string
  description?: ReactNode
  errorMessage?: ReactNode
  isInvalid?: boolean
  isDisabled?: boolean
  isRequired?: boolean
  withSearch?: boolean
  name?: string
  className?: string
  value?: UiSelectKey | null
  defaultValue?: UiSelectKey | null
  onChange?: (key: UiSelectKey | null) => void
}

const renderOption = (option: UiSelectOption) => (
  <ListBoxItem id={option.id} textValue={option.label} isDisabled={option.isDisabled}>
    {option.label}
  </ListBoxItem>
)

export function UiSelect({
  options,
  label,
  placeholder,
  description,
  errorMessage,
  isInvalid,
  withSearch,
  value,
  defaultValue,
  onChange,
  isDisabled,
  isRequired,
  name,
  className,
}: UiSelectProps) {
  const invalid = isInvalid ?? Boolean(errorMessage)
  const helper = description && !invalid ? <Description>{description}</Description> : null
  const error = invalid && errorMessage ? <FieldError>{errorMessage}</FieldError> : null

  if (withSearch) {
    return (
      <ComboBox
        defaultItems={options}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        isInvalid={invalid}
        isDisabled={isDisabled}
        isRequired={isRequired}
        name={name}
        className={className}
      >
        {label && <Label>{label}</Label>}
        <ComboBox.InputGroup>
          <Input placeholder={placeholder} />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        {helper}
        {error}
        <ComboBox.Popover>
          <ListBox<UiSelectOption>>{renderOption}</ListBox>
        </ComboBox.Popover>
      </ComboBox>
    )
  }

  return (
    <Select
      placeholder={placeholder}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      isInvalid={invalid}
      isDisabled={isDisabled}
      isRequired={isRequired}
      name={name}
      className={className}
    >
      {label && <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {helper}
      {error}
      <Select.Popover>
        <ListBox items={options}>{renderOption}</ListBox>
      </Select.Popover>
    </Select>
  )
}
