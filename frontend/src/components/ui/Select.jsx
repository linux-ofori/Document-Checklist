import { forwardRef, useId } from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'
import { cn } from '../../utils/cn'

export const Select = forwardRef(function Select(
  { label, hint, error, placeholder, options = [], id, required = false, className, wrapperClassName, children, ...rest },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hintId = hint ? `${selectId}-hint` : undefined
  const errorId = error ? `${selectId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('ui-field', wrapperClassName)}>
      {label ? (
        <label className="ui-label ui-field__label" htmlFor={selectId}>
          {label}
          {required ? (
            <span className="ui-field__required" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <div className="ui-select__wrapper">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'ui-field__control',
            'ui-select__control',
            error && 'ui-field__control--invalid',
            className,
          )}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}

          {children ??
            options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
        </select>

        <ChevronDown className="ui-select__indicator" size={16} aria-hidden="true" />
      </div>

      {hint && !error ? (
        <span className="ui-caption ui-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}

      {error ? (
        <span className="ui-caption ui-field__error" id={errorId}>
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  )
})