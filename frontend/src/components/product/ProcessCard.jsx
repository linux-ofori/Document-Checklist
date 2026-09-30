import {
  BookOpenCheck,
  Building2,
  Car,
  GraduationCap,
  IdCard,
  Layers,
  Stamp,
} from 'lucide-react'
import { Button, StatusBadge } from '../ui'
import { cn } from '../../utils/cn'
import { pluralize, formatDate } from '../../utils/format'

const ICONS = {
  passport: Stamp,
  business: Building2,
  driving: Car,
  university: GraduationCap,
  'national-id': IdCard,
  general: Layers,
}

export function ProcessIcon({ icon, size = 20, className }) {
  const Icon = ICONS[icon] ?? BookOpenCheck
  return <Icon size={size} aria-hidden="true" className={className} />
}

export function ProcessCard({ process, onStart, isStarting = false, className }) {
  return (
    <article className={cn('process-card', className)}>
      <div className="process-card__lead">
        <span className="process-card__icon" aria-hidden="true">
          <ProcessIcon icon={process.icon} />
        </span>
        {process.popularity ? <StatusBadge status="neutral">{process.popularity}</StatusBadge> : null}
      </div>

      <h3 className="ui-card-title process-card__title">{process.name}</h3>
      <p className="ui-body process-card__description">{process.description}</p>

      <dl className="process-card__meta">
        <div>
          <dt className="ui-caption">Requirements</dt>
          <dd>{pluralize(process.requirementCount, 'document')}</dd>
        </div>
        <div>
          <dt className="ui-caption">Time to prepare</dt>
          <dd>{process.estimatedTime}</dd>
        </div>
        <div>
          <dt className="ui-caption">Handled by</dt>
          <dd>{process.authority}</dd>
        </div>
      </dl>

      <div className="process-card__footer">
        <Button
          variant="primary"
          size="md"
          onClick={() => onStart?.(process)}
          isLoading={isStarting}
          disabled={isStarting}
        >
          Start application
        </Button>
        <span className="ui-caption">Updated {formatDate(process.updatedAt)}</span>
      </div>
    </article>
  )
}
