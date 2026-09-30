import { useState } from 'react'
import { KeyRound, LogOut, Save, ShieldCheck, Sparkles } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { Alert, Avatar, Button, Card, Input, LoadingState } from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { validateProfileForm } from '../utils/validation'
import { formatDate, formatDateTime, pluralize } from '../utils/format'
import { ROUTES } from '../utils/routes'

function ProfileDetailsForm({ profile }) {
  const { updateProfile } = useAppData()

  const [values, setValues] = useState({
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
  })
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)

  const setValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const validationErrors = validateProfileForm(values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      await updateProfile(values)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit} noValidate>
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
        required
        value={values.email}
        onChange={(event) => setValue('email', event.target.value)}
        error={errors.email}
        disabled={isSaving}
      />

      <div className="form-row">
        <Input
          label="Phone number"
          type="tel"
          value={values.phone}
          onChange={(event) => setValue('phone', event.target.value)}
          error={errors.phone}
          disabled={isSaving}
        />

        <Input
          label="Location"
          value={values.location}
          onChange={(event) => setValue('location', event.target.value)}
          disabled={isSaving}
        />
      </div>

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
  const { profile, stats, isLoading } = useAppData()

  if (isLoading && !profile) {
    return (
      <AppLayout>
        <div className="app-page">
          <LoadingState variant="skeleton" lines={4} label="Loading your profile" />
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
          onClick={() => navigate(ROUTES.login)}
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
              <p className="ui-caption">
                {profile.role} · {profile.location} · Member since{' '}
                {formatDate(profile.memberSince)}
              </p>
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
                <span className="profile-stat__value">{profile.completionRate}%</span>
                <span className="ui-caption">Average completion</span>
              </div>
            </div>
          </div>

          {profile.bio ? (
            <p className="ui-body profile-header__bio">{profile.bio}</p>
          ) : null}
        </Card>

        <Card
          title="Personal details"
          description="We only use your phone number for expiry reminders."
          padding="comfortable"
        >
          <ProfileDetailsForm key={profile.email} profile={profile} />
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
            <div className="definition-grid">
              <div className="definition-grid__item">
                <span className="ui-caption">Two-factor authentication</span>
                <span className="definition-grid__value">
                  {profile.security.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
                </span>
              </div>
              <div className="definition-grid__item">
                <span className="ui-caption">Last password change</span>
                <span className="definition-grid__value">
                  {formatDate(profile.security.lastPasswordChange)}
                </span>
              </div>
              <div className="definition-grid__item">
                <span className="ui-caption">Last sign in</span>
                <span className="definition-grid__value">
                  {formatDateTime(profile.security.lastSignIn)}
                </span>
              </div>
            </div>
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
