import { request } from './client'

function isNotification(notification) {
  return Boolean(
    notification
    && typeof notification.id === 'string'
    && notification.id
    && typeof notification.kind === 'string'
    && typeof notification.title === 'string'
    && typeof notification.body === 'string'
    && typeof notification.severity === 'string'
    && typeof notification.isRead === 'boolean'
    && (notification.applicationId === null || typeof notification.applicationId === 'string')
    && (notification.documentId === null || typeof notification.documentId === 'string')
    && (notification.dueDate === null || typeof notification.dueDate === 'string')
    && typeof notification.createdAt === 'string',
  )
}

export { isNotification }

export async function fetchNotifications() {
  const payload = await request('notifications')
  if (
    !Array.isArray(payload?.notifications)
    || !payload.notifications.every(isNotification)
  ) {
    throw new Error('The server returned an invalid notifications response.')
  }
  return [...new Map(payload.notifications.map((notification) => [notification.id, notification])).values()]
}

export async function readNotification(notificationId) {
  const payload = await request(
    `notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH' },
  )
  if (!isNotification(payload?.notification) || payload.notification.id !== notificationId) {
    throw new Error('The server returned an invalid notification response.')
  }
  return payload.notification
}

export async function readAllNotifications() {
  const payload = await request('notifications/read-all', { method: 'POST' })
  if (!Number.isInteger(payload?.updatedCount) || payload.updatedCount < 0) {
    throw new Error('The server returned an invalid read-all response.')
  }
  return payload.updatedCount
}
