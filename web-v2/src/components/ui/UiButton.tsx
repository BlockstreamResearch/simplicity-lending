import { Button, type ButtonProps, Spinner } from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiButtonProps extends Omit<ButtonProps, 'children'> {
  isLoading?: boolean
  loadingText?: ReactNode
  startContent?: ReactNode
  endContent?: ReactNode
  children?: ReactNode
}

export function UiButton({
  isLoading,
  loadingText,
  isDisabled,
  startContent,
  endContent,
  children,
  ...props
}: UiButtonProps) {
  return (
    <Button isDisabled={isDisabled || isLoading} {...props}>
      {isLoading ? <Spinner size='sm' color='current' aria-hidden /> : startContent}
      {isLoading ? (loadingText ?? children) : children}
      {!isLoading && endContent}
    </Button>
  )
}
