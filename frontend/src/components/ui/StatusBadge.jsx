import { cn } from '../../utils/cn'

const STATUSES = ['completed', 'pending', 'missing', 'expired', 'in-progress', 'neutral']

const DEFAULT_LABELS = {
  completed: 'Completed',
  pending: 'Pending',
  missing: 'Missing',
  expired: 'Expired',
  'in-progress': 'In progress',
  neutral: 'Neutral',
}

export function StatusBadge({ status = 'neutral', label, className, children }) {
  const safeStatus = STATUSES.includes(status) ? status : 'neutral'
  const resolvedLabel = label ?? DEFAULT_LABELS[safeStatus]

  return (
    <span className={cn('ui-badge', `ui-badge--${safeStatus}`, className)}>
      <span className="ui-badge__dot" aria-hidden="true" />
      {children ?? resolvedLabel}
    </span>
  )
}