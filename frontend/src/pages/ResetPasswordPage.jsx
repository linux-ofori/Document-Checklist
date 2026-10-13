import { useEffect, useState } from 'react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { AuthAside, AuthMobileBrand } from '../components/marketing/AuthAside'
import { Alert, Button, Input } from '../components/ui'
import { useAuth } from '../context/AuthProvider'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { confirmPasswordReset, hasAuthToken } from '../services'
import { validatePasswordResetForm } from '../utils/validation'
import { ROUTES } from '../utils/routes'

export function ResetPasswordPage() {
  const { navigate } = useActiveRoute()
  const { refreshUser } = useAuth()
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [values, setValues] = useState({ password: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [sessionNotice, setSessionNotice] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const setValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setFormError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')
    const validationErrors = validatePasswordResetForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    if (!token) {
      setFormError('This reset link is missing or invalid. Request a new one.')
      return
    }

    setIsSubmitting(true)
    try {
      await confirmPasswordReset({ token, password: values.password })
      if (hasAuthToken()) {
        try {
          await refreshUser()
        } catch (error) {
          if (error?.status !== 401) {
            setSessionNotice('Your password was changed, but we could not refresh your current session. If it belongs to the account whose password was reset, you may need to sign in again.')
          }
        }
      }
      setIsComplete(true)
    } catch (error) {
      if (error?.status === 429) {
        setFormError('Too many attempts. Please wait before trying again.')
      } else if (error?.status === 400) {
        setFormError('This reset link is invalid or expired. Request a new one.')
      } else if (error instanceof TypeError) {
        setFormError('Could not reach the server. Check your connection and try again.')
      } else {
        setFormError('We could not reset your password right now. Please try again later.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <MarketingLayout variant="bare">
      <div className="marketing-auth">
        <AuthAside
          headline="A fresh start for your account"
          lead="Choose a new password to get back to your document checklists."
        />
        <div className="marketing-auth__panel">
          <AuthMobileBrand />
          <div className="marketing-auth__card">
            <header>
              <h1 className="marketing-auth__title">Reset your password</h1>
              <p className="marketing-auth__lead">Use a password you have not used before.</p>
            </header>
            {formError ? <Alert tone="danger" title="Password not changed" description={formError} /> : null}
            {isComplete ? (
              <>
                <Alert tone="success" title="Password changed" description="You can now sign in with your new password." />
                {sessionNotice ? (
                  <Alert tone="warning" title="Session not refreshed" description={sessionNotice} />
                ) : null}
                <Button variant="primary" size="lg" onClick={() => navigate(ROUTES.login)}>
                  Go to log in
                </Button>
              </>
            ) : (
              <form className="marketing-auth__form" onSubmit={handleSubmit} noValidate>
                <Input
                  label="New password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={values.password}
                  onChange={(event) => setValue('password', event.target.value)}
                  error={errors.password}
                  disabled={isSubmitting}
                />
                <Input
                  label="Confirm new password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={values.confirmPassword}
                  onChange={(event) => setValue('confirmPassword', event.target.value)}
                  error={errors.confirmPassword}
                  disabled={isSubmitting}
                />
                <Button type="submit" variant="primary" size="lg" isLoading={isSubmitting}>
                  Set new password
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}
