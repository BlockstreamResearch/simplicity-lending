import { ToastQueue } from '@heroui/react'

/**
 * Separate toast queue/region (bottom-center) for pending-tx notifications, kept apart from the
 * default top-end queue used for regular error/success toasts elsewhere in the app.
 */
export const pendingTxToastQueue = new ToastQueue()
