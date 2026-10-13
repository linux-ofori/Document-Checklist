import { useState } from 'react'
import { KeyRound, Link2, LogOut, Save, ShieldCheck, Sparkles } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { Alert, Avatar, Button, Card, Input, LoadingState } from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { useAuth } from '../context/AuthProvider'
import { LOGOUT_WARNING_MESSAGE } from '../context/appDataReducer'
import { logout, requestEmailVerification, requestGoogleAuthorization } from '../services'
import { validateProfileForm } from '../utils/validation'
import { formatDate, formatDateTime, pluralize } from '../utils/format'
import { ROUTES } from '../utils/routes'

const GOOGLE_AUTH_INTENT_STORAGE_KEY = 'document-checklist-google-intent'

function ProfileDetailsForm({ profile }) {
  const { updateProfile } = useAppData()
  const { refreshUser } = useAuth()

  const [values, setValues] = useState({
    name: profile.name,
    phone: profile.phone,
  })
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [verificationState, setVerificationState] = useState('idle')
  const [verificationError, setVerificationError] = useState('')

  const setValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setFormError('')
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')

    const validationErrors = validateProfileForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      await updateProfile({ name: values.name, phone: values.phone })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'We could not save your profile. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleVerificationRequest = async () => {
    setVerificationState('sending')
    setVerificationError('')
    try {
      const result = await requestEmailVerification()
      if (result?.verified === true) {
        setVerificationState('verified')
        try {
          await refreshUser()
        } catch (error) {
          if (error?.status !== 401) {
            setVerificationError('Your email is already verified, but we could not refresh your profile status.')
          }
        }
      } else if (result?.delivered === true) {
        setVerificationState('sent')
      } else {
        throw new Error('The server did not confirm that a verification email was sent.')
      }
    } catch (error) {
      setVerificationState('idle')
      setVerificationError(error instanceof Error ? error.message : 'We could not send the verification email.')
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit} noValidate>
      {formError ? (
        <Alert tone="danger" title="Profile not saved" description={formError} />
      ) : null}
      {verificationError ? (
        <Alert
          tone={verificationState === 'verified' ? 'warning' : 'danger'}
          title={verificationState === 'verified' ? 'Verification status not refreshed' : 'Verification email not sent'}
          description={verificationError}
        />
      ) : null}

      <Input
        label="Full name"
        required
        value={values.name}
        onChange={(event) => setValue('name', event.target.value)}
        error={errors.name}
        disabled={isSaving}
      />

      <Input
        label="Email address"
        type="email"
        value={profile.email ?? ''}
        readOnly
        hint={profile.emailVerified === true ? 'Verified' : 'Not verified'}
      />
      {profile.emailVerified !== true ? (
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            size="md"
            isLoading={verificationState === 'sending'}
            disabled={verificationState === 'sent' || verificationState === 'verified' || isSaving}
            onClick={handleVerificationRequest}
          >
            {verificationState === 'verified'
              ? 'Email already verified'
              : verificationState === 'sent'
                ? 'Verification email sent'
                : 'Send verification email'}
          </Button>
        </div>
      ) : null}

      <Input
        label="Phone number"
        type="tel"
        value={values.phone}
        onChange={(event) => setValue('phone', event.target.value)}
        error={errors.phone}
        disabled={isSaving}
      />

      <div className="form-actions">
        <Button
          type="submit"
          variant="primary"
          size="md"
          isLoading={isSaving}
          leadingIcon={isSaving ? null : <Save size={16} aria-hidden="true" />}
        >
          {isSaving ? 'Saving' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

export function ProfilePage() {
  const { navigate } = useActiveRoute()
  const { signOut, user } = useAuth()
  const { profile: appProfile, stats, isLoading, retryHydration, showToast } = useAppData()
  const profile = appProfile
    ? {
        ...appProfile,
        emailVerified: user?.emailVerified ?? appProfile.emailVerified,
        googleLinked: user?.googleLinked ?? appProfile.googleLinked,
      }
    : null
  const [googlePassword, setGooglePassword] = useState('')
  const [googleLinkError, setGoogleLinkError] = useState('')
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false)
  const handleLogout = async () => {
    let serverLogoutFailed = false
    try {
      await logout()
    } catch {
      serverLogoutFailed = true
    }
    if (serverLogoutFailed) {
      showToast(LOGOUT_WARNING_MESSAGE, 'warning')
    }
    signOut()
    navigate(ROUTES.login)
  }

  const handleGoogleLink = async (event) => {
    event.preventDefault()
    setGoogleLinkError('')
    setIsLinkingGoogle(true)
    try {
      const result = await requestGoogleAuthorization({
        intent: 'link',
        currentPassword: googlePassword,
      })
      if (typeof result?.authorizationUrl !== 'string' || !result.authorizationUrl) {
        throw new Error('Google linking is unavailable. Please try again later.')
      }
      try {
        window.sessionStorage.setItem(GOOGLE_AUTH_INTENT_STORAGE_KEY, 'link')
      } catch {
        throw new Error('We could not save the Google-linking request. Please try again.')
      }
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      try {
        window.sessionStorage.removeItem(GOOGLE_AUTH_INTENT_STORAGE_KEY)
      } catch {
        // Ignore cleanup failure while reporting the authorization error.
      }
      setGoogleLinkError(error instanceof Error ? error.message : 'We could not start Google linking.')
      setIsLinkingGoogle(false)
    }
  }

  const documentCount = stats.completedDocuments + stats.inProgressDocuments + stats.missingDocuments
  const completionRate = documentCount
    ? Math.round((stats.completedDocuments / documentCount) * 100)
    : 0

  if (isLoading && !profile) {
    return (
      <AppLayout>
        <div className="app-page">
          <LoadingState variant="skeleton" lines={4} label="Loading your profile" />
        </div>
      </AppLayout>
    )
  }

  if (!profile) {
    return (
      <AppLayout>
        <div className="app-page">
          <Alert
            tone="danger"
            title="We could not load your profile"
            description="Check your connection and try again."
            action={<Button variant="outline" size="sm" onClick={retryHydration}>Retry</Button>}
          />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      actions={
        <Button
          variant="ghost"
          size="md"
          leadingIcon={<LogOut size={16} aria-hidden="true" />}
          onClick={handleLogout}
        >
          Log out
        </Button>
      }
    >
      <div className="app-page">
        <header className="page-section__title">
          <h1 className="ui-page-title">Profile</h1>
          <p className="ui-body">
            Your details, your progress, and the small print about how we handle your documents.
          </p>
        </header>

        <Card padding="comfortable">
          <div className="profile-header">
            <Avatar name={profile.name} size="xl" />

            <div className="profile-header__meta">
              <h2 className="ui-card-title">{profile.name}</h2>
              <p className="ui-body">{profile.email}</p>
              {profile.createdAt ? (
                <p className="ui-caption">Member since {formatDate(profile.createdAt)}</p>
              ) : null}
            </div>

            <div className="profile-header__stats">
              <div className="profile-stat">
                <span className="profile-stat__value">{stats.activeApplications}</span>
                <span className="ui-caption">Active applications</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__value">{stats.completedDocuments}</span>
                <span className="ui-caption">Documents collected</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__value">{completionRate}%</span>
                <span className="ui-caption">Checklist completion</span>
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Personal details"
          description="Update your name and phone number. Your email address remains read-only."
          padding="comfortable"
        >
          <ProfileDetailsForm key={profile.email} profile={profile} />
        </Card>

        <Card
          title="Google sign-in"
          description="Link Google to this account using your current password. Matching email addresses alone never link accounts."
          padding="comfortable"
        >
          {profile.googleLinked === true ? (
            <p className="ui-body">A Google identity is linked to this account.</p>
          ) : (
            <form className="form-stack" onSubmit={handleGoogleLink}>
              {googleLinkError ? (
                <Alert tone="danger" title="Google was not linked" description={googleLinkError} />
              ) : null}
              <Input
                label="Current password"
                type="password"
                required
                autoComplete="current-password"
                value={googlePassword}
                onChange={(event) => setGooglePassword(event.target.value)}
                disabled={isLinkingGoogle}
              />
              <div className="form-actions">
                <Button
                  type="submit"
                  variant="outline"
                  size="md"
                  isLoading={isLinkingGoogle}
                  leadingIcon={isLinkingGoogle ? null : <Link2 size={16} aria-hidden="true" />}
                >
                  Link Google account
                </Button>
              </div>
            </form>
          )}
        </Card>

        <div className="dashboard-grid">
          <Card
            title="Security"
            description="How your account is protected."
            padding="comfortable"
            footer={
              <Button
                variant="outline"
                size="md"
                leadingIcon={<KeyRound size={16} aria-hidden="true" />}
                onClick={() => navigate(ROUTES.settings)}
              >
                Change password
              </Button>
            }
          >
            {profile.security ? (
              <div className="definition-grid">
                {profile.security.twoFactorEnabled !== undefined ? (
                  <div className="definition-grid__item">
                    <span className="ui-caption">Two-factor authentication</span>
                    <span className="definition-grid__value">
                      {profile.security.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
                    </span>
                  </div>
                ) : null}
                {profile.security.lastPasswordChange ? (
                  <div className="definition-grid__item">
                    <span className="ui-caption">Last password change</span>
                    <span className="definition-grid__value">
                      {formatDate(profile.security.lastPasswordChange)}
                    </span>
                  </div>
                ) : null}
                {profile.security.lastSignIn ? (
                  <div className="definition-grid__item">
                    <span className="ui-caption">Last sign in</span>
                    <span className="definition-grid__value">
                      {formatDateTime(profile.security.lastSignIn)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="ui-body">Additional security details are not available from your account profile.</p>
            )}
          </Card>

          <Card title="Your data" padding="comfortable">
            <Alert
              tone="info"
              icon={<ShieldCheck size={18} aria-hidden="true" />}
              title="You control your documents"
              description={`You have uploaded ${pluralize(
                stats.completedDocuments + stats.inProgressDocuments + stats.missingDocuments,
                'document record',
              )}. Delete any of them at any time and the file is removed for good.`}
            />

            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Sparkles size={14} aria-hidden="true" />}
              onClick={() => navigate(ROUTES.documents)}
            >
              Manage documents
            </Button>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
