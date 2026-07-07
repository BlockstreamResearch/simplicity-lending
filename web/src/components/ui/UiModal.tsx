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
  dialogClassName?: string
}

export function UiModal({
  title,
  children,
  footer,
  trigger,
  size,
  placement = 'center',
  isDismissable = true,
  showCloseButton = true,
  dialogClassName,
  ...rootProps
}: UiModalProps) {
  const useDefaultWidth = !size && !dialogClassName
  const dialogClass = [useDefaultWidth ? 'max-w-120' : dialogClassName].filter(Boolean).join(' ')

  return (
    <Modal.Root {...rootProps}>
      {trigger ? <Modal.Trigger>{trigger}</Modal.Trigger> : null}
      <Modal.Backdrop isDismissable={isDismissable}>
        <Modal.Container size={size} placement={placement}>
          <Modal.Dialog className={dialogClass || undefined}>
            {title || showCloseButton ? (
              <Modal.Header>
                {title ? <Modal.Heading>{title}</Modal.Heading> : null}
                {showCloseButton ? <Modal.CloseTrigger /> : null}
              </Modal.Header>
            ) : null}
            <Modal.Body className='mt-6 px-1 pb-1'>{children}</Modal.Body>
            {footer ? <Modal.Footer className='mt-6 px-1 pb-1'>{footer}</Modal.Footer> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
