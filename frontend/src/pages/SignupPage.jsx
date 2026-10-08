import { useMemo, useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { AuthAside, AuthMobileBrand } from '../components/marketing/AuthAside'
import { Alert, Button, Checkbox, Input } from '../components/ui'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { useAppData } from '../hooks/useAppData'
import { useAuth } from '../context/AuthProvider'
import { request, storeAuthToken } from '../services'
import { validateSignUpForm, passwordStrength } from '../utils/validation'
import { ROUTES } from '../utils/routes'

const INITIAL_VALUES = {
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  terms: false,
  updates: true,
}

const RULES = [
  { id: 'length', label: 'At least 8 characters' },
  { id: 'letter', label: 'Contains a letter' },
  { id: 'number', label: 'Contains a number' },
]

export function SignupPage() {
  const { navigate } = useActiveRoute()
  const { authenticate } = useAuth()
  const { isLoading, showToast } = useAppData()

  const [values, setValues] = useState(INITIAL_VALUES)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const strength = useMemo(() => passwordStrength(values.password), [values.password])
  const metRules = strength.rules

  const setValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))

    setErrors((current) => {
      const shouldClear = Boolean(current[key]) || (key === 'password' && current.confirmPassword)
      if (!shouldClear) return current

      const next = { ...current }
      delete next[key]
      if (key === 'password') delete next.confirmPassword
      return next
    })

    setFormError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')

    const validationErrors = validateSignUpForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSubmitting(true)
    const phone = String(values.phone ?? '').trim()

    try {
      const result = await request('auth/register', {
        method: 'POST',
        body: {
          name: values.name,
          email: values.email,
          password: values.password,
          ...(phone ? { phone } : {}),
        },
      })

      if (!storeAuthToken(result?.token)) {
        throw new Error('Your account was created, but we could not save your sign-in. Please log in.')
      }

      authenticate(result.user)
      showToast('Account created. Choose a process to build your first checklist.')
      navigate(ROUTES.chooseProcess)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'We could not create your account.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <MarketingLayout variant="bare">
      <div className="marketing-auth">
        <AuthAside
          headline="Build your first checklist in under two minutes"
          lead="Create an account, pick the process you are applying for, and we will list every document the office expects plus how long each one stays valid."
        />

        <div className="marketing-auth__panel">
          <AuthMobileBrand />

          <div className="marketing-auth__card">
            <header>
              <h1 className="marketing-auth__title">Create your account</h1>
              <p className="marketing-auth__lead">
                Free, and you can delete your documents whenever you want.
              </p>
            </header>

            {formError ? (
              <Alert tone="danger" title="We could not create your account" description={formError} />
            ) : null}

            <form className="marketing-auth__form" onSubmit={handleSubmit} noValidate>
              <Input
                label="Full name"
                type="text"
                required
                autoComplete="name"
                placeholder="Ama Owusu"
                value={values.name}
                onChange={(event) => setValue('name', event.target.value)}
                error={errors.name}
                disabled={isSubmitting}
              />

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
                label="Phone number"
                type="tel"
                autoComplete="tel"
                placeholder="+233 24 000 0000"
                value={values.phone}
                onChange={(event) => setValue('phone', event.target.value)}
                error={errors.phone}
                disabled={isSubmitting}
                hint="Optional. Used only for expiry reminders."
              />

              <div>
                <Input
                  label="Password"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  value={values.password}
                  onChange={(event) => setValue('password', event.target.value)}
                  error={errors.password}
                  disabled={isSubmitting}
                />

                {values.password ? (
                  <div className="password-meter">
                    <div className="password-meter__track" aria-hidden="true">
                      {[1, 2, 3, 4].map((segment) => (
                        <span
                          key={segment}
                          className={`password-meter__segment ${
                            segment <= strength.score ? 'password-meter__segment--on' : ''
                          }`}
                        />
                      ))}
                    </div>

                    <div className="password-meter__meta">
                      <ul className="password-rules">
                        {RULES.map((rule) => {
                          const isMet = metRules.includes(rule.id)

                          return (
                            <li
                              key={rule.id}
                              className={`password-rule ${isMet ? 'password-rule--met' : ''}`}
                            >
                              {isMet ? <Check size={12} aria-hidden="true" /> : null}
                              {rule.label}
                            </li>
                          )
                        })}
                      </ul>
                      <span>Strength: {strength.label}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <Input
                label="Confirm password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={values.confirmPassword}
                onChange={(event) => setValue('confirmPassword', event.target.value)}
                error={errors.confirmPassword}
                disabled={isSubmitting}
              />

              <Checkbox
                label={
                  <>
                    I agree to the <a href="#terms">terms of use</a> and{' '}
                    <a href="#privacy">privacy policy</a>.
                  </>
                }
                required
                checked={values.terms}
                disabled={isSubmitting}
                onChange={(event) => setValue('terms', event.target.checked)}
                error={errors.terms}
              />

              <Checkbox
                label="Send me a weekly summary of missing documents and expiring items."
                checked={values.updates}
                disabled={isSubmitting}
                onChange={(event) => setValue('updates', event.target.checked)}
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isSubmitting}
                disabled={isLoading}
                leadingIcon={isSubmitting ? null : <UserPlus size={16} aria-hidden="true" />}
              >
                {isSubmitting ? 'Creating your account' : 'Create account'}
              </Button>
            </form>

            <p className="marketing-auth__switch">
              Already have an account?{' '}
              <a
                href={ROUTES.login}
                onClick={(event) => {
                  event.preventDefault()
                  navigate(ROUTES.login)
                }}
              >
                Log in
              </a>
            </p>

            <p className="marketing-auth__legal">
              By creating an account you agree to store your documents securely. We never sell your
              personal information.
            </p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}
