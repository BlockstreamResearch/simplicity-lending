import { Spinner, type SpinnerProps } from '@heroui/react'

export type UiSpinnerProps = SpinnerProps

export function UiSpinner(props: UiSpinnerProps) {
  return <Spinner {...props} />
}
