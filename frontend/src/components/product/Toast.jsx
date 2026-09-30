import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useAppData } from '../../hooks/useAppData'
import { cn } from '../../utils/cn'

const TONE_ICONS = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  neutral: Info,
}

export function Toast() {
  const { toast, dismissToast } = useAppData()

  if (!toast) return null

  const tone = TONE_ICONS[toast.tone] ? toast.tone : 'success'
  const Icon = TONE_ICONS[tone]

  return (
    <div className="toast-region" role="status" aria-live="polite">
      <div className={cn('toast', `toast--${tone}`)}>
        <span className="toast__icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <p className="toast__message">{toast.message}</p>
        <button type="button" className="toast__close" onClick={dismissToast}>
          <X size={16} aria-hidden="true" />
          <span className="ui-visually-hidden">Dismiss notification</span>
        </button>
      </div>
    </div>
  )
}
