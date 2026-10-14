import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleCallbackPage } from './GoogleCallbackPage'

const googleCallbackHarness = vi.hoisted(() => ({
  auth: {
    authenticate: vi.fn(),
    refreshUser: vi.fn(),
    signOut: vi.fn(),
  },
  navigate: vi.fn(),
  consumeGoogleRememberPreference: vi.fn(() => true),
  exchangeGoogleTicket: vi.fn(),
  hasAuthToken: vi.fn(() => false),
  storeAuthToken: vi.fn(() => true),
}))

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => googleCallbackHarness.auth,
}))

vi.mock('../hooks/useActiveRoute', () => ({
  useActiveRoute: () => ({ navigate: googleCallbackHarness.navigate }),
}))

vi.mock('../services', () => ({
  consumeGoogleRememberPreference: (...args) =>
    googleCallbackHarness.consumeGoogleRememberPreference(...args),
  exchangeGoogleTicket: (...args) => googleCallbackHarness.exchangeGoogleTicket(...args),
  hasAuthToken: (...args) => googleCallbackHarness.hasAuthToken(...args),
  storeAuthToken: (...args) => googleCallbackHarness.storeAuthToken(...args),
}))

const INTENT_KEY = 'document-checklist-google-intent'

function setCallbackHash(hash) {
  window.history.replaceState({}, '', `/auth/google/callback${hash}`)
}

function setIntent(intent) {
  window.sessionStorage.setItem(INTENT_KEY, intent)
}

beforeEach(() => {
  googleCallbackHarness.auth = {
    authenticate: vi.fn(),
    refreshUser: vi.fn(),
    signOut: vi.fn(),
  }
  googleCallbackHarness.navigate.mockReset()
  googleCallbackHarness.consumeGoogleRememberPreference.mockReset().mockReturnValue(true)
  googleCallbackHarness.exchangeGoogleTicket.mockReset()
  googleCallbackHarness.hasAuthToken.mockReset().mockReturnValue(false)
  googleCallbackHarness.storeAuthToken.mockReset().mockReturnValue(true)
  window.sessionStorage.clear()
  setCallbackHash('')
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  setCallbackHash('/')
  vi.restoreAllMocks()
})

describe('GoogleCallbackPage', () => {
  it('exchanges a login ticket, stores the selected persistence, and navigates to the dashboard', async () => {
    const user = { id: 'user-one', email: 'person@example.test' }
    setCallbackHash('#ticket=single-use-ticket')
    setIntent('login')
    googleCallbackHarness.exchangeGoogleTicket.mockResolvedValue({
      token: 'session-token',
      user,
    })
    render(<GoogleCallbackPage />)

    await waitFor(() => {
      expect(googleCallbackHarness.auth.authenticate).toHaveBeenCalledWith(user)
      expect(googleCallbackHarness.navigate).toHaveBeenCalledWith('/dashboard')
    })

    expect(googleCallbackHarness.exchangeGoogleTicket).toHaveBeenCalledWith('single-use-ticket')
    expect(googleCallbackHarness.consumeGoogleRememberPreference).toHaveBeenCalled()
    expect(googleCallbackHarness.storeAuthToken).toHaveBeenCalledWith('session-token', true)
    expect(window.location.hash).toBe('')
    expect(window.sessionStorage.getItem(INTENT_KEY)).toBeNull()
  })

  it('refreshes and returns to profile after a successful account-link exchange', async () => {
    setCallbackHash('#ticket=link-ticket')
    setIntent('link')
    googleCallbackHarness.hasAuthToken.mockReturnValue(true)
    googleCallbackHarness.exchangeGoogleTicket.mockResolvedValue({ linked: true })
    googleCallbackHarness.auth.refreshUser.mockResolvedValue({
      id: 'user-one',
      email: 'person@example.test',
      googleLinked: true,
    })
    render(<GoogleCallbackPage />)

    await waitFor(() => expect(googleCallbackHarness.navigate).toHaveBeenCalledWith('/profile'))

    expect(googleCallbackHarness.exchangeGoogleTicket).toHaveBeenCalledWith('link-ticket')
    expect(googleCallbackHarness.auth.refreshUser).toHaveBeenCalled()
    expect(googleCallbackHarness.auth.authenticate).not.toHaveBeenCalled()
    expect(googleCallbackHarness.auth.signOut).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(window.sessionStorage.getItem(INTENT_KEY)).toBeNull()
  })

  it('reports a missing ticket and clears the callback fragment and intent', async () => {
    setCallbackHash('#state=callback-state')
    setIntent('login')
    render(<GoogleCallbackPage />)

    expect(await screen.findByText('Google sign-in could not be completed. Please try again.')).toBeTruthy()
    expect(googleCallbackHarness.exchangeGoogleTicket).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(window.sessionStorage.getItem(INTENT_KEY)).toBeNull()
  })

  it('reports provider cancellation without changing the existing link session', async () => {
    setCallbackHash('#error=access_denied')
    setIntent('link')
    googleCallbackHarness.hasAuthToken.mockReturnValue(true)
    render(<GoogleCallbackPage />)

    expect(await screen.findByText(/Your current session was kept unchanged/)).toBeTruthy()
    expect(googleCallbackHarness.exchangeGoogleTicket).not.toHaveBeenCalled()
    expect(googleCallbackHarness.auth.authenticate).not.toHaveBeenCalled()
    expect(googleCallbackHarness.auth.signOut).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('keeps the current session when ticket exchange fails during linking', async () => {
    setCallbackHash('#ticket=link-ticket')
    setIntent('link')
    googleCallbackHarness.hasAuthToken.mockReturnValue(true)
    googleCallbackHarness.exchangeGoogleTicket.mockRejectedValue(new Error('Exchange failed'))
    googleCallbackHarness.auth.refreshUser.mockResolvedValue({ googleLinked: false })
    render(<GoogleCallbackPage />)

    expect(await screen.findByText('Link status unconfirmed')).toBeTruthy()
    expect(screen.getByText(/Your current session was kept unchanged/)).toBeTruthy()
    expect(googleCallbackHarness.auth.authenticate).not.toHaveBeenCalled()
    expect(googleCallbackHarness.auth.signOut).not.toHaveBeenCalled()
    expect(googleCallbackHarness.navigate).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('reports token-storage failure instead of authenticating a Google login', async () => {
    setCallbackHash('#ticket=login-ticket')
    setIntent('login')
    googleCallbackHarness.exchangeGoogleTicket.mockResolvedValue({
      token: 'session-token',
      user: { id: 'user-one', email: 'person@example.test' },
    })
    googleCallbackHarness.storeAuthToken.mockReturnValue(false)
    render(<GoogleCallbackPage />)

    expect(await screen.findByText('We could not save your sign-in. Please try again.')).toBeTruthy()
    expect(googleCallbackHarness.auth.signOut).toHaveBeenCalled()
    expect(googleCallbackHarness.auth.authenticate).not.toHaveBeenCalled()
    expect(googleCallbackHarness.navigate).not.toHaveBeenCalled()
  })
})
