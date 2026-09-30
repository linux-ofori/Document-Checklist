import { forwardRef, useCallback, useId } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '../../utils/cn'

export const Checkbox = forwardRef(function Checkbox(
  {
    label,
    description,
    checked,
    indeterminate = false,
    disabled = false,
    className,
    wrapperClassName,
    id,
    ...rest
  },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const descriptionId = description ? `${controlId}-description` : undefined

  const attachRef = useCallback(
    (node) => {
      if (node) {
        node.indeterminate = Boolean(indeterminate) && !checked
      }

      if (typeof ref === 'function') {
        ref(node)
        return
      }

      if (ref) {
        ref.current = node
      }
    },
    [checked, indeterminate, ref],
  )

  const isMixed = Boolean(indeterminate) && !checked

  return (
    <label className={cn('ui-checkbox', className, wrapperClassName)} htmlFor={controlId}>
      <span className="ui-checkbox__control">
        <input
          ref={attachRef}
          id={controlId}
          type="checkbox"
          className="ui-checkbox__input"
          checked={Boolean(checked)}
          disabled={disabled}
          aria-checked={isMixed ? 'mixed' : undefined}
          aria-describedby={descriptionId}
          {...rest}
        />
        <span className="ui-checkbox__box" aria-hidden="true">
          {isMixed ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
        </span>
      </span>

      <span className="ui-checkbox__text">
        {label ? <span className="ui-checkbox__label">{label}</span> : null}
        {description ? (
          <span className="ui-caption" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
})
