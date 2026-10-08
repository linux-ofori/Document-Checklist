import {
  Bell,
  BellRing,
  CircleAlert,
  CircleCheck,
  Clock,
  FileWarning,
  Inbox,
} from 'lucide-react'
import { StatusBadge } from '../ui'
import { formatCountdown, formatRelativeTime } from '../../utils/format'
import { cn } from '../../utils/cn'

const KIND_META = {
  expiry: { icon: Clock, label: 'Expiry' },
  'missing-document': { icon: FileWarning, label: 'Missing' },
  application: { icon: BellRing, label: 'Application' },
  system: { icon: Inbox, label: 'Account' },
}

const SEVERITY_ICONS = {
  danger: CircleAlert,
  warning: Clock,
  info: Bell,
  success: CircleCheck,
}

export function NotificationCard({
  notification,
  onRead,
  onOpenApplication,
  onOpenDocument,
  actionLabel = 'View checklist',
}) {
  const kind = KIND_META[notification.kind] ?? KIND_META.system
  const SeverityIcon = SEVERITY_ICONS[notification.severity] ?? Bell

  return (
    <article
      className={cn(
        'notification-card',
        !notification.isRead && 'notification-card--unread',
        `notification-card--${notification.severity}`,
      )}
    >
      <span className="notification-card__icon" aria-hidden="true">
        <SeverityIcon size={18} />
      </span>

      <div className="notification-card__body">
        <div className="notification-card__head">
          <h3 className="notification-card__title">{notification.title}</h3>
          {!notification.isRead ? (
            <span className="notification-card__dot">
              <span className="ui-visually-hidden">Unread</span>
            </span>
          ) : null}
        </div>

        <p className="ui-body notification-card__text">{notification.body}</p>

        <div className="notification-card__meta">
          <StatusBadge status="neutral">{kind.label}</StatusBadge>
          {notification.applicationName ? (
            <span className="ui-caption">{notification.applicationName}</span>
          ) : null}
          {notification.dueDate ? (
            <span className={cn('ui-caption', notification.isOverdue && 'notification-card__overdue')}>
              {formatCountdown(notification.dueDate)}
            </span>
          ) : null}
          <span className="ui-caption">{formatRelativeTime(notification.createdAt)}</span>
        </div>
      </div>

      <div className="notification-card__actions">
        {notification.applicationId && onOpenApplication ? (
          <button
            type="button"
            className="notification-card__action"
            onClick={() => onOpenApplication?.(notification)}
          >
            {actionLabel}
          </button>
        ) : null}

        {notification.documentId && onOpenDocument ? (
          <button
            type="button"
            className="notification-card__action"
            onClick={() => onOpenDocument(notification)}
          >
            View document
          </button>
        ) : null}

        {!notification.isRead ? (
          <button
            type="button"
            className="notification-card__action notification-card__action--muted"
            onClick={() => onRead?.(notification.id)}
          >
            Mark as read
          </button>
        ) : null}
      </div>
    </article>
  )
}
