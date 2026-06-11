import {
  Modal,
  type ModalBackdropProps,
  type ModalContainerProps,
  type ModalProps,
} from '@heroui/react'
import type { ReactNode } from 'react'

export interface UiModalProps extends ModalProps {
  title?: ReactNode
  footer?: ReactNode
  trigger?: ReactNode
  size?: ModalContainerProps['size']
  placement?: ModalContainerProps['placement']
  isDismissable?: ModalBackdropProps['isDismissable']
  showCloseButton?: boolean
}

export function UiModal({
  title,
  children,
  footer,
  trigger,
  size,
  placement,
  isDismissable = true,
  showCloseButton = true,
  ...rootProps
}: UiModalProps) {
  return (
    <Modal.Root {...rootProps}>
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
            <Modal.Body className='mt-8 px-1 pb-1'>{children}</Modal.Body>
            {footer ? <Modal.Footer className='mt-8'>{footer}</Modal.Footer> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
