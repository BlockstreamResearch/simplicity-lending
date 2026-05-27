import { Modal, type ModalContainerProps } from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiModalProps {
  isOpen?: boolean
  defaultOpen?: boolean
  onOpenChange?: (isOpen: boolean) => void
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  trigger?: ReactNode
  size?: ModalContainerProps['size']
  placement?: ModalContainerProps['placement']
  isDismissable?: boolean
  showCloseButton?: boolean
}

export function UiModal({
  isOpen,
  defaultOpen,
  onOpenChange,
  title,
  children,
  footer,
  trigger,
  size,
  placement,
  isDismissable = true,
  showCloseButton = true,
}: UiModalProps) {
  return (
    <Modal.Root isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <Modal.Trigger>{trigger}</Modal.Trigger> : null}
      <Modal.Backdrop isDismissable={isDismissable}>
        <Modal.Container size={size} placement={placement}>
          <Modal.Dialog>
            {title || showCloseButton ? (
              <Modal.Header>
                {title ? <Modal.Heading>{title}</Modal.Heading> : null}
                {showCloseButton ? <Modal.CloseTrigger /> : null}
              </Modal.Header>
            ) : null}
            <Modal.Body>{children}</Modal.Body>
            {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
