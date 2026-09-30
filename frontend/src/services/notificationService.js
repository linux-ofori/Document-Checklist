import { NOTIFICATIONS } from '../data'
import { resolveAfter, resolvePayload } from './client'

export function fetchNotifications() {
  return resolvePayload(NOTIFICATIONS, 340)
}

export function readNotification(notificationId) {
  return resolveAfter(140).then(() => ({ id: notificationId, isRead: true }))
}

export function readAllNotifications() {
  return resolveAfter(200).then(() => ({ isRead: true, all: true }))
}
