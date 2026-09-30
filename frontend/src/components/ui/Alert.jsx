import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '../../utils/cn'

const TONES = ['info', 'success', 'warning', 'danger']

const TONE_ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
}

export function Alert({ tone = 'info', title, description, icon, action, className, children }) {
  const safeTone = TONES.includes(tone) ? tone : 'info'
  const ToneIcon = TONE_ICONS[safeTone]

  return (
    <div className={cn('ui-alert', `ui-alert--${safeTone}`, className)} role="status">
      <span className="ui-alert__icon" aria-hidden="true">
        {icon ?? <ToneIcon size={18} />}
      </span>

      <div className="ui-alert__body">
        {title ? <p className="ui-alert__title">{title}</p> : null}
        {description ? <p className="ui-body">{description}</p> : null}
        {children}
      </div>

      {action ? <div className="ui-alert__action">{action}</div> : null}
    </div>
  )
}
