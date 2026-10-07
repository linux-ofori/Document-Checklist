import { useState } from 'react'
import { Lock } from 'lucide-react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { AuthAside, AuthMobileBrand } from '../components/marketing/AuthAside'
import { GoogleButton } from '../components/marketing/GoogleButton'
import { Alert, Button, Checkbox, Input } from '../components/ui'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { useAppData } from '../hooks/useAppData'
import { request, storeAuthToken } from '../services'
import { validateLoginForm } from '../utils/validation'
import { ROUTES } from '../utils/routes'

const INITIAL_VALUES = { email: '', password: '', remember: true }

export function LoginPage() {
  const { navigate } = useActiveRoute()
  const { isLoading, showToast } = useAppData()

  const [values, setValues] = useState(INITIAL_VALUES)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [formError, setFormError] = useState('')

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

    const validationErrors = validateLoginForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSubmitting(true)

    try {
      const result = await request('auth/login', {
        method: 'POST',
        body: {
          email: values.email,
          password: values.password,
        },
      })

      if (!storeAuthToken(result?.token)) {
        throw new Error('We could not save your sign-in. Please try again.')
      }

      showToast('Welcome back. Loading your checklists.')
      navigate(ROUTES.dashboard)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'We could not sign you in. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogle = () => {
    setIsGoogleLoading(true)
    window.setTimeout(() => {
      setIsGoogleLoading(false)
      showToast('Signed in with Google.')
      navigate(ROUTES.dashboard)
    }, 700)
  }

  const handleForgotPassword = () => {
    showToast('Password reset instructions would be emailed to you.', 'info')
  }

  return (
    <MarketingLayout variant="bare">
      <div className="marketing-auth">
        <AuthAside
          headline="Everything you need for the next application"
          lead="Sign in to pick up your checklists where you left off, upload a document, or clear a reminder before it becomes a problem."
        />

        <div className="marketing-auth__panel">
          <AuthMobileBrand />

          <div className="marketing-auth__card">
            <header>
              <h1 className="marketing-auth__title">Welcome back</h1>
              <p className="marketing-auth__lead">Log in to continue to your documentation workspace.</p>
            </header>

            {formError ? (
              <Alert tone="danger" title="We could not sign you in" description={formError} />
            ) : null}

            <form className="marketing-auth__form" onSubmit={handleSubmit} noValidate>
              <Input
                label="Email address"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={values.email}
                onChange={(event) => setValue('email', event.target.value)}
                error={errors.email}
                disabled={isSubmitting}
              />

              <Input
                label="Password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={values.password}
                onChange={(event) => setValue('password', event.target.value)}
                error={errors.password}
                disabled={isSubmitting}
              />

              <div className="marketing-auth__row">
                <Checkbox
                  label="Remember me"
                  checked={values.remember}
                  disabled={isSubmitting}
                  onChange={(event) => setValue('remember', event.target.checked)}
                />
                <button type="button" className="marketing-auth__link" onClick={handleForgotPassword}>
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                disabled={isLoading}
                leadingIcon={isSubmitting ? null : <Lock size={16} aria-hidden="true" />}
              >
                {isSubmitting ? 'Signing in' : 'Log in'}
              </Button>
            </form>

            <p className="auth-divider">or</p>

            <GoogleButton onClick={handleGoogle} isLoading={isGoogleLoading} />

            <p className="marketing-auth__switch">
              New here?{' '}
              <a
                href={ROUTES.signup}
                onClick={(event) => {
                  event.preventDefault()
                  navigate(ROUTES.signup)
                }}
              >
                Create an account
              </a>
            </p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}
