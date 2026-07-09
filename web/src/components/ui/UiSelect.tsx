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

export interface UiSelectOption extends ListBoxItemRootProps {
  /** Extra content rendered after the label, e.g. a "Demo only" chip. */
  badge?: ReactNode
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
          {({ badge, ...option }: UiSelectOption) => (
            <ListBoxItem {...option}>
              <span className='flex items-center gap-2'>
                {option.textValue}
                {badge}
              </span>
            </ListBoxItem>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
