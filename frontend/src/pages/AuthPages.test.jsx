import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { SignupPage } from './SignupPage'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { VerifyEmailPage } from './VerifyEmailPage'

const authPagesHarness = vi.hoisted(() => ({
  auth: {
    authenticate: vi.fn(),
    signOut: vi.fn(),
    refreshUser: vi.fn(),
  },
  appData: {
    isLoading: false,
    showToast: vi.fn(),
  },
  navigate: vi.fn(),
  request: vi.fn(),
  storeAuthToken: vi.fn(() => true),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  hasAuthToken: vi.fn(() => false),
  confirmEmailVerification: vi.fn(),
}))

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => authPagesHarness.auth,
}))

vi.mock('../hooks/useActiveRoute', () => ({
  useActiveRoute: () => ({ navigate: authPagesHarness.navigate }),
}))

vi.mock('../hooks/useAppData', () => ({
  useAppData: () => authPagesHarness.appData,
}))

vi.mock('../services', () => ({
  request: (...args) => authPagesHarness.request(...args),
  storeAuthToken: (...args) => authPagesHarness.storeAuthToken(...args),
  requestPasswordReset: (...args) => authPagesHarness.requestPasswordReset(...args),
  confirmPasswordReset: (...args) => authPagesHarness.confirmPasswordReset(...args),
  hasAuthToken: (...args) => authPagesHarness.hasAuthToken(...args),
  confirmEmailVerification: (...args) => authPagesHarness.confirmEmailVerification(...args),
}))

function setRoute(url) {
  window.history.replaceState({}, '', url)
}

function fillLoginForm() {
  fireEvent.change(screen.getByLabelText(/^Email address/), {
    target: { value: 'person@example.test' },
  })
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'ValidPass1' },
  })
}

function fillSignupForm() {
  fireEvent.change(screen.getByLabelText(/^Full name/), {
    target: { value: 'Test Person' },
  })
  fireEvent.change(screen.getByLabelText(/^Email address/), {
    target: { value: 'person@example.test' },
  })
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'ValidPass1' },
  })
  fireEvent.change(screen.getByLabelText(/^Confirm password/), {
    target: { value: 'ValidPass1' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: /agree to the terms/i }))
}

function fillResetForm() {
  fireEvent.change(screen.getByLabelText(/^New password/), {
    target: { value: 'ValidPass2' },
  })
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
    target: { value: 'ValidPass2' },
  })
}

beforeEach(() => {
  authPagesHarness.auth = {
    authenticate: vi.fn(),
    signOut: vi.fn(),
    refreshUser: vi.fn(),
  }
  authPagesHarness.appData = {
    isLoading: false,
    showToast: vi.fn(),
  }
  authPagesHarness.navigate.mockReset()
  authPagesHarness.request.mockReset()
  authPagesHarness.storeAuthToken.mockReset().mockReturnValue(true)
  authPagesHarness.requestPasswordReset.mockReset()
  authPagesHarness.confirmPasswordReset.mockReset()
  authPagesHarness.hasAuthToken.mockReset().mockReturnValue(false)
  authPagesHarness.confirmEmailVerification.mockReset()
  setRoute('/')
})

afterEach(() => {
  cleanup()
  setRoute('/')
  vi.restoreAllMocks()
})

describe('authentication pages', () => {
  it.each([
    ['remembered', true],
    ['session-only', false],
  ])('logs in successfully with %s token persistence', async (_label, remember) => {
    const user = { id: 'user-one', email: 'person@example.test' }
    authPagesHarness.request.mockResolvedValue({ token: 'login-token', user })
    render(<LoginPage />)
    fillLoginForm()

    const rememberSwitch = screen.getByRole('checkbox', { name: 'Remember me' })
    if (!remember) fireEvent.click(rememberSwitch)
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => {
      expect(authPagesHarness.storeAuthToken).toHaveBeenCalledWith('login-token', remember)
      expect(authPagesHarness.auth.authenticate).toHaveBeenCalledWith(user)
      expect(authPagesHarness.navigate).toHaveBeenCalledWith('/dashboard')
    })
    expect(authPagesHarness.request).toHaveBeenCalledWith('auth/login', {
      method: 'POST',
      body: { email: 'person@example.test', password: 'ValidPass1' },
    })
  })

  it('surfaces login request errors without authenticating', async () => {
    authPagesHarness.request.mockRejectedValue(new Error('Invalid credentials.'))
    render(<LoginPage />)
    fillLoginForm()
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Invalid credentials.')).toBeTruthy()
    expect(authPagesHarness.auth.authenticate).not.toHaveBeenCalled()
    expect(authPagesHarness.navigate).not.toHaveBeenCalled()
  })

  it('registers with only supported fields and does not display an unsupported weekly-summary option', async () => {
    const user = { id: 'user-one', email: 'person@example.test' }
    authPagesHarness.request.mockResolvedValue({ token: 'signup-token', user })
    render(<SignupPage />)
    fillSignupForm()

    expect(screen.queryByRole('checkbox', { name: /weekly summary/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(authPagesHarness.storeAuthToken).toHaveBeenCalledWith('signup-token')
      expect(authPagesHarness.auth.authenticate).toHaveBeenCalledWith(user)
      expect(authPagesHarness.navigate).toHaveBeenCalledWith('/applications/new')
    })
    expect(authPagesHarness.request).toHaveBeenCalledWith('auth/register', {
      method: 'POST',
      body: {
        name: 'Test Person',
        email: 'person@example.test',
        password: 'ValidPass1',
      },
    })
  })

  it('surfaces signup errors without authenticating', async () => {
    authPagesHarness.request.mockRejectedValue(new Error('An account with that email already exists.'))
    render(<SignupPage />)
    fillSignupForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('An account with that email already exists.')).toBeTruthy()
    expect(authPagesHarness.auth.authenticate).not.toHaveBeenCalled()
    expect(authPagesHarness.navigate).not.toHaveBeenCalled()
  })

  it('shows a generic success message after a password-reset request', async () => {
    authPagesHarness.requestPasswordReset.mockResolvedValue({})
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText(/^Email address/), {
      target: { value: 'person@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }))

    expect(await screen.findByText(
      'If an account exists for that email address, password reset instructions will be sent.',
    )).toBeTruthy()
    expect(authPagesHarness.requestPasswordReset).toHaveBeenCalledWith('person@example.test')
  })

  it('shows rate-limit feedback for a password-reset request', async () => {
    authPagesHarness.requestPasswordReset.mockRejectedValue(Object.assign(
      new Error('Rate limited'),
      { status: 429 },
    ))
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText(/^Email address/), {
      target: { value: 'person@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }))

    expect(await screen.findByText('Too many requests. Please wait before trying again.')).toBeTruthy()
  })

  it.each([
    ['network', new TypeError('Network unavailable')],
    ['server', Object.assign(new Error('Service unavailable'), { status: 503 })],
  ])('shows safe feedback for password-reset request %s failures', async (_label, error) => {
    authPagesHarness.requestPasswordReset.mockRejectedValue(error)
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText(/^Email address/), {
      target: { value: 'person@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }))

    expect(await screen.findByText(
      'We could not process the request right now. Please try again later.',
    )).toBeTruthy()
  })

  it('reports an expired password-reset link', async () => {
    setRoute('/reset-password?token=expired-token')
    authPagesHarness.confirmPasswordReset.mockRejectedValue(Object.assign(
      new Error('Expired'),
      { status: 400 },
    ))
    render(<ResetPasswordPage />)
    fillResetForm()
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('This reset link is invalid or expired. Request a new one.')).toBeTruthy()
    expect(authPagesHarness.confirmPasswordReset).toHaveBeenCalledWith({
      token: 'expired-token',
      password: 'ValidPass2',
    })
  })

  it('reports successful password reset', async () => {
    setRoute('/reset-password?token=valid-token')
    authPagesHarness.confirmPasswordReset.mockResolvedValue({})
    render(<ResetPasswordPage />)
    fillResetForm()
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('Password changed')).toBeTruthy()
    expect(authPagesHarness.confirmPasswordReset).toHaveBeenCalledWith({
      token: 'valid-token',
      password: 'ValidPass2',
    })
  })

  it('confirms an email-verification success without claiming signed-in identity was verified', async () => {
    setRoute('/verify-email?token=verification-token')
    authPagesHarness.confirmEmailVerification.mockResolvedValue({})
    render(<VerifyEmailPage />)

    await waitFor(() => expect(screen.getByText('Verification complete')).toBeTruthy())
    expect(screen.getByText(/Sign in to the account associated with this link/)).toBeTruthy()
    expect(authPagesHarness.confirmEmailVerification).toHaveBeenCalledWith('verification-token')
  })

  it('shows invalid or expired email-verification feedback', async () => {
    setRoute('/verify-email?token=expired-token')
    authPagesHarness.confirmEmailVerification.mockRejectedValue(Object.assign(
      new Error('Expired'),
      { status: 400 },
    ))
    render(<VerifyEmailPage />)

    expect(await screen.findByText(
      'This verification link is invalid or expired. Request a new email from your profile.',
    )).toBeTruthy()
    expect(screen.getByText('Verification not completed')).toBeTruthy()
  })
})
