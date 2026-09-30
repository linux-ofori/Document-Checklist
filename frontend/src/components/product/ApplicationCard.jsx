import { ArrowRight, CircleAlert, Clock } from 'lucide-react'
import { ProgressBar, StatusBadge } from '../ui'
import { formatCountdown, formatRelativeTime } from '../../utils/format'
import { ProcessIcon } from './ProcessCard'

export function ApplicationCard({ application, onOpen, compact = false }) {
  const { process, summary } = application

  return (
    <article className="application-card">
      <div className="application-card__lead">
        <span className="application-card__icon" aria-hidden="true">
          <ProcessIcon icon={process?.icon} size={18} />
        </span>

        <div className="application-card__heading">
          <h3 className="ui-card-title application-card__title">{application.name}</h3>
          <p className="ui-caption">
            {application.reference} · Updated {formatRelativeTime(application.updatedAt)}
          </p>
        </div>

        <StatusBadge status={application.badgeStatus}>{application.statusLabel}</StatusBadge>
      </div>

      <ProgressBar
        value={application.progress}
        label={compact ? undefined : 'Overall progress'}
        variant={application.progress === 100 ? 'success' : 'primary'}
        size={compact ? 'sm' : 'md'}
      />

      <div className="application-card__stats">
        <span className="application-card__stat application-card__stat--success">
          {summary.completed} completed
        </span>
        <span className="application-card__stat application-card__stat--progress">
          {summary.inProgress} in progress
        </span>
        <span
          className={`application-card__stat ${
            summary.missing > 0 ? 'application-card__stat--missing' : ''
          }`}
        >
          {summary.missing} missing
        </span>
      </div>

      <p className="ui-body application-card__next">
        {summary.missing > 0 ? <CircleAlert size={15} aria-hidden="true" /> : null}
        <span>{application.nextStep}</span>
      </p>

      <div className="application-card__footer">
        {application.dueDate ? (
          <span className="ui-caption application-card__due">
            <Clock size={14} aria-hidden="true" />
            {formatCountdown(application.dueDate)}
          </span>
        ) : (
          <span className="ui-caption">No deadline</span>
        )}

        <button
          type="button"
          className="application-card__link"
          onClick={() => onOpen?.(application)}
        >
          Open checklist
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}
