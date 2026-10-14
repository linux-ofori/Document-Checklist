export const NOTIFICATION_KINDS = [
  'expiry',
  'document-expiry',
  'missing-document',
  'application',
  'system',
]

export function isExpiryNotification(notification) {
  return notification?.kind === 'expiry' || notification?.kind === 'document-expiry'
}

export const NOTIFICATION_KIND_LABELS = {
  expiry: 'Expiry reminders',
  'document-expiry': 'Expiry reminders',
  'missing-document': 'Missing documents',
  application: 'Application reminders',
  system: 'Account updates',
}
