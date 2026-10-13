import { useEffect, useRef, useState } from 'react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { AuthAside, AuthMobileBrand } from '../components/marketing/AuthAside'
import { Alert, Button, LoadingState } from '../components/ui'
import { useAuth } from '../context/AuthProvider'
import { useActiveRoute } from '../hooks/useActiveRoute'
import {
  consumeGoogleRememberPreference,
  exchangeGoogleTicket,
  hasAuthToken,
  storeAuthToken,
} from '../services'
import { ROUTES } from '../utils/routes'

const GOOGLE_AUTH_INTENT_STORAGE_KEY = 'document-checklist-google-intent'

function consumeGoogleAuthorizationIntent() {
  let intent = null
  try {
    intent = window.sessionStorage.getItem(GOOGLE_AUTH_INTENT_STORAGE_KEY)
  } catch {
    return null
  }

  try {
    window.sessionStorage.removeItem(GOOGLE_AUTH_INTENT_STORAGE_KEY)
  } catch {
    // The intent is still available for this callback even if cleanup fails.
  }
  return intent === 'link' || intent === 'login' ? intent : null
}

export function GoogleCallbackPage() {
  const { navigate } = useActiveRoute()
  const { authenticate, refreshUser, signOut } = useAuth()
  const [error, setError] = useState('')
  const [linkConfirmed, setLinkConfirmed] = useState(false)
  const [outcomeUncertain, setOutcomeUncertain] = useState(false)
  const [failureIntent, setFailureIntent] = useState(null)
  const [isProcessing, setIsProcessing] = useState(true)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const parameters = new URLSearchParams(window.location.hash.slice(1))
    const ticket = parameters.get('ticket')
    const providerError = parameters.get('error')
    window.history.replaceState(null, '', window.location.pathname)

    const completeSignIn = async () => {
      let intent = consumeGoogleAuthorizationIntent()
      const hadSession = hasAuthToken()
      try {
        if (providerError || !ticket) {
          consumeGoogleRememberPreference()
          setFailureIntent(intent)
          if (intent === 'link') {
            setError('Google linking could not be completed. Your current session was kept unchanged. Check your profile before trying again.')
          } else if (intent === 'login') {
            setError('Google sign-in could not be completed. Please try again.')
          } else {
            setError('Google authorization could not be completed. Please try again.')
          }
          setIsProcessing(false)
          return
        }

        let result
        try {
          result = await exchangeGoogleTicket(ticket)
        } catch (exchangeError) {
          consumeGoogleRememberPreference()
          if (intent === 'login') {
            setFailureIntent('login')
            setError('Google sign-in could not be completed. Please try again.')
            setIsProcessing(false)
            return
          }
          if (intent === null) {
            setError('Google authorization could not be completed. Please try again.')
            setIsProcessing(false)
            return
          }
          if (!hadSession) throw exchangeError

          try {
            const currentUser = await refreshUser()
            if (currentUser?.googleLinked === true) {
              navigate(ROUTES.profile)
              return
            }
          } catch {
            // Keep the existing session and report that the link state is unknown.
          }

          setFailureIntent('link')
          setOutcomeUncertain(true)
          setError('We could not confirm whether Google linking completed. Your current session was kept unchanged. Check your profile before trying again.')
          setIsProcessing(false)
          return
        }

        if (intent === null) {
          if (result?.linked === true) {
            intent = 'link'
          } else if (typeof result?.token === 'string' && result.token && result.user) {
            intent = 'login'
          } else {
            setError('Google authorization could not be completed. Please try again.')
            setIsProcessing(false)
            return
          }
        }

        if (intent === 'login' && typeof result?.token === 'string' && result.token && result.user) {
          const remember = consumeGoogleRememberPreference()
          if (!storeAuthToken(result.token, remember)) {
            signOut()
            throw new Error('We could not save your sign-in. Please try again.')
          }
          authenticate(result.user)
          navigate(ROUTES.dashboard)
          return
        }

        if (intent === 'link' && result?.linked === true) {
          if (!hasAuthToken()) {
            setFailureIntent('link')
            setLinkConfirmed(true)
            setError('Google was linked to your account. Sign in again to continue.')
            setIsProcessing(false)
            return
          }

          try {
            const currentUser = await refreshUser()
            if (!currentUser) {
              throw new Error('The current profile could not be refreshed.')
            }
          } catch {
            setFailureIntent('link')
            setLinkConfirmed(true)
            setError('Google was linked to your account, but we could not refresh your profile. Your session is unchanged; return to your profile to check the connection.')
            setIsProcessing(false)
            return
          }
          navigate(ROUTES.profile)
          return
        }

        if (intent === 'link' && hadSession) {
          try {
            const currentUser = await refreshUser()
            if (currentUser?.googleLinked === true) {
              navigate(ROUTES.profile)
              return
            }
          } catch {
            // Keep the existing session and report that the link state is unknown.
          }
          setFailureIntent('link')
          setOutcomeUncertain(true)
          setError('We could not confirm whether Google linking completed. Your current session was kept unchanged. Check your profile before trying again.')
          setIsProcessing(false)
          return
        }

        throw new Error('Google sign-in could not be completed. Please try again.')
      } catch (requestError) {
        consumeGoogleRememberPreference()
        setFailureIntent(intent)
        setError(requestError instanceof Error
          ? requestError.message
          : 'Google sign-in could not be completed. Please try again.')
        setIsProcessing(false)
      }
    }

    completeSignIn()
  }, [authenticate, navigate, refreshUser, signOut])

  return (
    <MarketingLayout variant="bare">
      <div className="marketing-auth">
        <AuthAside
          headline="Secure sign-in, without the extra steps"
          lead="Completing your Google sign-in and returning you to your account."
        />
        <div className="marketing-auth__panel">
          <AuthMobileBrand />
          <div className="marketing-auth__card">
            <header>
              <h1 className="marketing-auth__title">Google sign-in</h1>
            </header>
            {isProcessing ? (
              <LoadingState label="Completing Google sign-in" />
            ) : (
              <>
                <Alert
                  tone={outcomeUncertain || linkConfirmed ? 'warning' : 'danger'}
                  title={
                    linkConfirmed
                      ? 'Google linked; profile not refreshed'
                      : outcomeUncertain
                        ? 'Link status unconfirmed'
                        : failureIntent === 'link'
                          ? 'Google linking not completed'
                          : failureIntent === 'login'
                            ? 'Sign-in not completed'
                            : 'Google authorization not completed'
                  }
                  description={error}
                />
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => navigate(hasAuthToken() ? ROUTES.profile : ROUTES.login)}
                >
                  {hasAuthToken() ? 'Return to profile' : 'Return to log in'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </MarketingLayout>
  )
}
