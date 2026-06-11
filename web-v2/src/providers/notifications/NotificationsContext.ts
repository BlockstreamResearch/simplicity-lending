import { createContext, useContext } from 'react'

import type { NotificationAction, NotificationVariant } from '@/components/Notification'

export interface NotifyOptions {
  variant: NotificationVariant
  title: string
  description?: string
  action?: NotificationAction
}

export interface NotificationItem extends NotifyOptions {
  id: string
}

export interface NotificationsContextValue {
  notifications: NotificationItem[]
  notify: (options: NotifyOptions) => void
  dismiss: (id: string) => void
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within <NotificationsProvider />')
  return ctx
}
