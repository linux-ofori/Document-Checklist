import { useState } from 'react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { AuthAside, AuthMobileBrand } from '../components/marketing/AuthAside'
import { Alert, Button, Input } from '../components/ui'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { requestPasswordReset } from '../services'
import { isValidEmail } from '../utils/validation'
import { ROUTES } from '../utils/routes'

export function ForgotPasswordPage() {
  const { navigate } = useActiveRoute()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!isValidEmail(email) || email.trim().length > 254) {
      setError('Enter a valid email address.')
      return
    }

    setIsSubmitting(true)
    try {
      await requestPasswordReset(email.trim())
      setMessage('If an account exists for that email address, password reset instructions will be sent.')
    } catch (requestError) {
      setError(requestError?.status === 429
        ? 'Too many requests. Please wait before trying again.'
        : 'We could not process the request right now. Please try again later.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <MarketingLayout variant="bare">
      <div className="marketing-auth">
        <AuthAside
          headline="Get back to your checklist"
          lead="Request a secure, single-use password reset link for your account."
        />
        <div className="marketing-auth__panel">
          <AuthMobileBrand />
          <div className="marketing-auth__card">
            <header>
              <h1 className="marketing-auth__title">Forgot your password?</h1>
              <p className="marketing-auth__lead">Enter the email address associated with your account.</p>
            </header>
            {error ? <Alert tone="danger" title="Request not completed" description={error} /> : null}
            {message ? <Alert tone="success" title="Check your inbox" description={message} /> : null}
            <form className="marketing-auth__form" onSubmit={handleSubmit} noValidate>
              <Input
                label="Email address"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
              />
              <Button type="submit" variant="primary" size="lg" isLoading={isSubmitting}>
                Send reset instructions
              </Button>
            </form>
            <p className="marketing-auth__switch">
              Remembered it?{' '}
              <a href={ROUTES.login} onClick={(event) => { event.preventDefault(); navigate(ROUTES.login) }}>
                Log in
              </a>
            </p>
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}
