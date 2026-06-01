import { Button, type ButtonProps, Spinner } from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiButtonProps extends ButtonProps {
  loadingText?: ReactNode
}

export function UiButton({ isPending, loadingText, children, ...props }: UiButtonProps) {
  return (
    <Button isPending={isPending} {...props}>
      {isPending ? (
        <>
          <Spinner size='sm' color='current' aria-hidden />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
