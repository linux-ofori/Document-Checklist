import { forwardRef, useId } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '../../utils/cn'

export const Input = forwardRef(function Input(
  { label, hint, error, id, required = false, className, wrapperClassName, ...rest },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('ui-field', wrapperClassName)}>
      {label ? (
        <label className="ui-label ui-field__label" htmlFor={inputId}>
          {label}
          {required ? (
            <span className="ui-field__required" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </label>
      ) : null}

      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('ui-field__control', error && 'ui-field__control--invalid', className)}
        {...rest}
      />

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