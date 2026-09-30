import { forwardRef, useId } from 'react'
import { cn } from '../../utils/cn'

export const Switch = forwardRef(function Switch(
  { label, description, checked, disabled = false, className, wrapperClassName, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const descriptionId = description ? `${controlId}-description` : undefined

  return (
    <div className={cn('ui-switch', className, wrapperClassName)}>
      <label className="ui-switch__label" htmlFor={controlId}>
        <span className="ui-switch__text">
          <span className="ui-switch__title">{label}</span>
          {description ? (
            <span className="ui-caption" id={descriptionId}>
              {description}
            </span>
          ) : null}
        </span>
        <input
          ref={ref}
          id={controlId}
          type="checkbox"
          role="switch"
          className="ui-switch__input"
          checked={Boolean(checked)}
          disabled={disabled}
          aria-describedby={descriptionId}
          {...rest}
        />
        <span className="ui-switch__track" aria-hidden="true">
          <span className="ui-switch__thumb" />
        </span>
      </label>
    </div>
  )
})
