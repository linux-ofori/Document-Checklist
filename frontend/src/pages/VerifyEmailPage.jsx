import { useEffect, useRef, useState } from 'react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { AuthAside, AuthMobileBrand } from '../components/marketing/AuthAside'
import { Alert, Button, LoadingState } from '../components/ui'
import { useAuth } from '../context/AuthProvider'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { confirmEmailVerification, hasAuthToken } from '../services'
import { ROUTES } from '../utils/routes'

export function VerifyEmailPage() {
  const { navigate } = useActiveRoute()
  const { status: authStatus, refreshUser } = useAuth()
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [state, setState] = useState(token ? 'checking' : 'error')
  const [message, setMessage] = useState(
    token ? '' : 'This verification link is missing or invalid. Request a new email from your profile.',
  )
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    window.history.replaceState(null, '', window.location.pathname)
    if (!token) return

    const confirm = async () => {
      try {
        await confirmEmailVerification(token)
      } catch (error) {
        setState('error')
        if (error?.status === 429) {
          setMessage('Too many attempts. Please wait before trying again.')
        } else if (error?.status === 400) {
          setMessage('This verification link is invalid or expired. Request a new email from your profile.')
        } else if (error instanceof TypeError) {
          setMessage('Could not reach the server. Check your connection and try again.')
        } else {
          setMessage('We could not verify your email right now. Please try again later.')
        }
        return
      }

      setState('success')
      if (!hasAuthToken()) {
        setMessage('The verification link was accepted. Sign in to the account associated with this link to view its verification status.')
        return
      }

      try {
        const currentUser = await refreshUser()
        setMessage(currentUser
          ? 'The verification link was accepted. Your signed-in profile was refreshed, but this does not confirm that it belongs to the account associated with the link.'
          : 'The verification link was accepted. Your session changed before we could refresh your profile.')
      } catch {
        setMessage('The verification link was accepted, but we could not refresh your signed-in profile. Sign in to the account associated with the link to view its status.')
      }
    }

    confirm()
  }, [authStatus, refreshUser, token])

  return (
    <MarketingLayout variant="bare">
      <div className="marketing-auth">
        <AuthAside
          headline="Keep your account secure"
          lead="Verify your email address so it can be used for account recovery."
        />
        <div className="marketing-auth__panel">
          <AuthMobileBrand />
          <div className="marketing-auth__card">
            <header>
              <h1 className="marketing-auth__title">Email verification</h1>
            </header>
            {state === 'checking' ? (
              <LoadingState label="Verifying your email address" />
            ) : (
              <>
                <Alert
                  tone={state === 'success' ? 'success' : 'danger'}
                  title={state === 'success' ? 'Verification complete' : 'Verification not completed'}
                  description={message}
                />
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => navigate(
                    authStatus === 'authenticated' || hasAuthToken() ? ROUTES.profile : ROUTES.login,
                  )}
                >
                  {authStatus === 'authenticated' || hasAuthToken() ? 'Return to profile' : 'Go to log in'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}
