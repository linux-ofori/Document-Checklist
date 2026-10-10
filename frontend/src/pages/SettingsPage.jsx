import { useState } from 'react'
import { Bell, KeyRound, Save, ShieldCheck } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { Alert, Button, Card, Input, LoadingState, Switch } from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { PREFERENCE_OPTIONS } from '../data'
import { validateChangePasswordForm } from '../utils/validation'

const EMPTY_PASSWORD_VALUES = { currentPassword: '', newPassword: '', confirmPassword: '' }

function PreferencesForm({ profile }) {
  const { updatePreferences, showToast } = useAppData()

  const [preferences, setPreferences] = useState(() => ({ ...profile.preferences }))
  const [isSavingPreferences, setIsSavingPreferences] = useState(false)
  const [preferenceError, setPreferenceError] = useState('')

  const togglePreference = (id, value) => {
    setPreferences((current) => ({ ...current, [id]: value }))
    setPreferenceError('')
  }

  const handleSavePreferences = async () => {
    setIsSavingPreferences(true)
    setPreferenceError('')
    try {
      const updatedPreferences = await updatePreferences(preferences)
      if (updatedPreferences) {
        showToast('Your notification preferences have been saved.')
      }
    } catch (error) {
      setPreferences({ ...profile.preferences })
      setPreferenceError(error instanceof Error ? error.message : 'We could not save your preferences. Please try again.')
    } finally {
      setIsSavingPreferences(false)
    }
  }

  return (
    <Card
      title="Notifications"
      description="Choose which document expiry and application update notifications you receive."
      padding="comfortable"
      footer={
        <Button
          variant="primary"
          size="md"
          isLoading={isSavingPreferences}
          leadingIcon={isSavingPreferences ? null : <Save size={16} aria-hidden="true" />}
          onClick={handleSavePreferences}
        >
          {isSavingPreferences ? 'Saving' : 'Save preferences'}
        </Button>
      }
    >
      <div className="muted-panel">
        {preferenceError ? (
          <Alert tone="danger" title="Preferences not saved" description={preferenceError} />
        ) : null}
        {PREFERENCE_OPTIONS.map((option) => (
          <Switch
            key={option.id}
            label={option.label}
            description={option.description}
            checked={option.alwaysOn || Boolean(preferences[option.id])}
            disabled={isSavingPreferences || option.alwaysOn}
            onChange={(event) => togglePreference(option.id, event.target.checked)}
          />
        ))}
      </div>
    </Card>
  )
}

export function SettingsPage() {
  const { profile, isLoading, retryHydration, changePassword, showToast } = useAppData()

  const [passwordValues, setPasswordValues] = useState(EMPTY_PASSWORD_VALUES)
  const [passwordErrors, setPasswordErrors] = useState({})
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordFormError, setPasswordFormError] = useState('')

  if (isLoading && !profile) {
    return (
      <AppLayout>
        <div className="app-page">
          <LoadingState variant="skeleton" lines={4} label="Loading your settings" />
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
            title="We could not load your settings"
            description="Check your connection and try again."
            action={<Button variant="outline" size="sm" onClick={retryHydration}>Retry</Button>}
          />
        </div>
      </AppLayout>
    )
  }

  const setPasswordValue = (key, value) => {
    setPasswordValues((current) => ({ ...current, [key]: value }))
    setPasswordFormError('')
    setPasswordErrors((current) => {
      const shouldClear =
        Boolean(current[key]) || (key === 'newPassword' && current.confirmPassword)
      if (!shouldClear) return current

      const next = { ...current }
      delete next[key]
      if (key === 'newPassword') delete next.confirmPassword
      return next
    })
  }

  const handleChangePassword = async (event) => {
    event.preventDefault()
    setPasswordFormError('')

    const validationErrors = validateChangePasswordForm(passwordValues)
    if (Object.keys(validationErrors).length > 0) {
      setPasswordErrors(validationErrors)
      return
    }

    setIsChangingPassword(true)
    try {
      const changed = await changePassword({
        currentPassword: passwordValues.currentPassword,
        newPassword: passwordValues.newPassword,
      })
      if (!changed) return
      setPasswordValues(EMPTY_PASSWORD_VALUES)
      setPasswordErrors({})
    } catch (error) {
      setPasswordFormError(error instanceof Error ? error.message : 'We could not change your password. Please try again.')
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <AppLayout>
      <div className="app-page">
        <header className="page-section__title">
          <h1 className="ui-page-title">Settings</h1>
          <p className="ui-body">
            Choose what we remind you about, and keep your account secure.
          </p>
        </header>

        <PreferencesForm key={profile.email} profile={profile} />

        <Card
          title="Password"
          description="Use at least eight characters that you do not use anywhere else."
          padding="comfortable"
        >
          <form className="form-stack" onSubmit={handleChangePassword} noValidate>
            {passwordFormError ? (
              <Alert tone="danger" title="Password not changed" description={passwordFormError} />
            ) : null}
            <Input
              label="Current password"
              type="password"
              required
              autoComplete="current-password"
              value={passwordValues.currentPassword}
              onChange={(event) => setPasswordValue('currentPassword', event.target.value)}
              error={passwordErrors.currentPassword}
              disabled={isChangingPassword}
            />

            <Input
              label="New password"
              type="password"
              required
              autoComplete="new-password"
              value={passwordValues.newPassword}
              onChange={(event) => setPasswordValue('newPassword', event.target.value)}
              error={passwordErrors.newPassword}
              disabled={isChangingPassword}
            />

            <Input
              label="Confirm new password"
              type="password"
              required
              autoComplete="new-password"
              value={passwordValues.confirmPassword}
              onChange={(event) => setPasswordValue('confirmPassword', event.target.value)}
              error={passwordErrors.confirmPassword}
              disabled={isChangingPassword}
            />

            <div className="form-actions">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isChangingPassword}
                leadingIcon={isChangingPassword ? null : <KeyRound size={16} aria-hidden="true" />}
              >
                {isChangingPassword ? 'Updating' : 'Change password'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="dashboard-grid">
          <Card
            title="Account security"
            description="Two-factor authentication is not enabled on this account."
            padding="comfortable"
            footer={
              <Button
                variant="outline"
                size="md"
                leadingIcon={<ShieldCheck size={16} aria-hidden="true" />}
                onClick={() => showToast('Two-factor setup would open here.', 'info')}
              >
                Enable two-factor
              </Button>
            }
          >
            <p className="ui-body">
              Adding a second step makes it much harder for someone else to get into your document
              library, even if they guess your password.
            </p>
          </Card>

          <Card title="Data and privacy" padding="comfortable">
            <Alert
              tone="info"
              icon={<Bell size={18} aria-hidden="true" />}
              title="Security and account notifications stay enabled"
              description="This setting is always on to help protect your account."
            />
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
