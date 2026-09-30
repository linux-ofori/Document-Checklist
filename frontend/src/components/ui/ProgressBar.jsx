import { cn } from '../../utils/cn'
import { clampProgress } from '../../utils/format'

const VARIANTS = ['primary', 'secondary', 'accent', 'success', 'warning', 'danger']
const SIZES = ['sm', 'md']

export function ProgressBar({
  value = 0,
  max = 100,
  label,
  valueLabel,
  showValue = true,
  variant = 'primary',
  size = 'md',
  className,
}) {
  const safeVariant = VARIANTS.includes(variant) ? variant : VARIANTS[0]
  const safeSize = SIZES.includes(size) ? size : SIZES[1]
  const clamped = clampProgress(value, max)
  const percentage = max > 0 ? Math.round((clamped / max) * 100) : 0
  const accessibleValue = `${percentage}%`

  return (
    <div className={cn('ui-progress', className)}>
      {label || showValue ? (
        <div className="ui-progress__meta">
          {label ? <span className="ui-label">{label}</span> : <span />}
          {showValue ? <span className="ui-caption">{valueLabel ?? accessibleValue}</span> : null}
        </div>
      ) : null}

      <div
        className={cn('ui-progress__track', `ui-progress__track--${safeSize}`)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={valueLabel ?? accessibleValue}
        aria-label={label}
      >
        <div
          className={cn('ui-progress__fill', `ui-progress__fill--${safeVariant}`)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}