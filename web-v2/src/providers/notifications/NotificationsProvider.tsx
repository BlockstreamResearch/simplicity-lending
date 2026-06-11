import { type PropsWithChildren, useCallback, useRef, useState } from 'react'

import {
  type NotificationItem,
  NotificationsContext,
  type NotifyOptions,
} from './NotificationsContext'

const AUTO_DISMISS_MS = 8_000

export function NotificationsProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(item => item.id !== id))
  }, [])

  const notify = useCallback(
    (options: NotifyOptions) => {
      const id = String((idRef.current += 1))
      setNotifications(prev => [...prev, { id, ...options }])
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  return (
    <NotificationsContext.Provider value={{ notifications, notify, dismiss }}>
      {children}
    </NotificationsContext.Provider>
  )
}
