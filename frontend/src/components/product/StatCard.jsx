import { cn } from '../../utils/cn'

const TONE_CLASSES = {
  primary: 'stat-card--primary',
  secondary: 'stat-card--secondary',
  success: 'stat-card--success',
  warning: 'stat-card--warning',
  danger: 'stat-card--danger',
  neutral: 'stat-card--neutral',
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  footer,
  onClick,
  isLoading = false,
  className,
}) {
  const content = (
    <>
      <div className="stat-card__lead">
        <span className="stat-card__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="ui-label stat-card__label">{label}</span>
      </div>

      {isLoading ? (
        <span className="ui-skeleton" style={{ height: 28, width: 64 }} />
      ) : (
        <p className="stat-card__value">{value}</p>
      )}

      {hint ? <p className="ui-caption stat-card__hint">{hint}</p> : null}
      {footer ? <div className="stat-card__footer">{footer}</div> : null}
    </>
  )

  const classes = cn('stat-card', TONE_CLASSES[tone] ?? TONE_CLASSES.neutral, className)

  if (!onClick) {
    return (
      <div className={classes}>
        {content}
      </div>
    )
  }

  return (
    <button type="button" className={cn(classes, 'stat-card--interactive')} onClick={onClick}>
      {content}
    </button>
  )
}
