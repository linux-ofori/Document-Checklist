const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function getInitials(name) {
  if (!name) return ''

  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function clampProgress(value, max = 100) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return 0

  return Math.min(Math.max(numeric, 0), max)
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value, fallback = 'Not set') {
  const date = toDate(value)
  return date ? DATE_FORMATTER.format(date) : fallback
}

export function formatDateTime(value, fallback = 'Not set') {
  const date = toDate(value)
  return date ? DATE_TIME_FORMATTER.format(date) : fallback
}

export function formatRelativeTime(value, now = new Date()) {
  const date = toDate(value)
  if (!date) return 'Not set'

  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)
  const diffDays = Math.round(diffMs / 86400000)

  if (Math.abs(diffMinutes) < 1) return 'Just now'
  if (Math.abs(diffMinutes) < 60) return `${Math.abs(diffMinutes)}m ago`
  if (Math.abs(diffHours) < 24) return `${Math.abs(diffHours)}h ago`
  if (Math.abs(diffDays) < 30) return `${Math.abs(diffDays)}d ago`

  return formatDate(date)
}

export function daysUntil(value, now = new Date()) {
  const date = toDate(value)
  if (!date) return null

  const startOfDay = (input) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()

  return Math.round((startOfDay(date) - startOfDay(now)) / 86400000)
}

export function formatCountdown(value, now = new Date()) {
  const remaining = daysUntil(value, now)

  if (remaining === null) return 'No date set'
  if (remaining === 0) return 'Due today'
  if (remaining === 1) return 'Due tomorrow'
  if (remaining > 1) return `Due in ${remaining} days`
  if (remaining === -1) return 'Overdue by 1 day'

  return `Overdue by ${Math.abs(remaining)} days`
}

export function formatFileSize(sizeKb) {
  const numeric = Number(sizeKb)
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 KB'
  if (numeric < 1024) return `${Math.round(numeric)} KB`
  return `${(numeric / 1024).toFixed(1)} MB`
}

export function pluralize(count, singular, plural) {
  const numeric = Number(count) || 0
  return `${numeric} ${numeric === 1 ? singular : (plural ?? `${singular}s`)}`
}

export function toIsoDate(date = new Date()) {
  return new Date(date).toISOString()
}

export function addDays(date, days) {
  const base = toDate(date) ?? new Date()
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next.toISOString()
}

export function addMonths(date, months) {
  const base = toDate(date) ?? new Date()
  const next = new Date(base)
  next.setMonth(next.getMonth() + Number(months ?? 0))
  return next
}

export function toDateInputValue(value) {
  const date = toDate(value)
  return date ? date.toISOString().slice(0, 10) : ''
}
