import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearAuthToken, request, storeAuthToken } from './services'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('./services', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, request: requestMock }
})

vi.mock('./context/AppDataProvider', () => ({
  AppDataProvider: ({ children }) => children,
}))

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <h1>Login route</h1>,
}))

vi.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <h1>Dashboard route</h1>,
}))

function setPath(path) {
  window.history.replaceState({}, '', path)
}

beforeEach(() => {
  clearAuthToken()
  requestMock.mockReset()
  setPath('/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  clearAuthToken()
  setPath('/')
  vi.restoreAllMocks()
})

describe('App route guard', () => {
  it('shows session-check loading on a protected route while verification is pending', () => {
    const pending = new Promise(() => {})
    storeAuthToken('stored-token')
    requestMock.mockReturnValueOnce(pending)
    setPath('/dashboard')

    render(<App />)

    expect(screen.getByText('Checking your session')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('auth/me')
  })

  it('redirects an unauthenticated visitor from a protected route to login', async () => {
    setPath('/documents')

    render(<App />)

    expect(await screen.findByText('Login route')).toBeTruthy()
    expect(window.location.pathname).toBe('/login')
  })

  it('shows the verification error state rather than redirecting on a network failure', async () => {
    storeAuthToken('stored-token')
    requestMock.mockRejectedValueOnce(new TypeError('Network unavailable'))
    setPath('/settings')

    render(<App />)

    expect(await screen.findByText('Unable to verify your session')).toBeTruthy()
    expect(screen.getByText(
      'We could not verify your session. Check your connection and try again.',
    )).toBeTruthy()
    expect(window.location.pathname).toBe('/settings')
  })

  it('allows public account routes while session verification is unauthenticated', async () => {
    setPath('/forgot-password')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeTruthy()
    expect(window.location.pathname).toBe('/forgot-password')
    expect(request).not.toHaveBeenCalled()
  })

  it('renders protected application content after successful session verification', async () => {
    storeAuthToken('stored-token')
    requestMock.mockResolvedValueOnce({
      user: { id: 'user-one', email: 'person@example.test' },
    })
    setPath('/dashboard')

    render(<App />)

    await waitFor(() => expect(screen.queryByText('Checking your session')).toBeNull())
    expect(window.location.pathname).toBe('/dashboard')
    expect(screen.getByText('Dashboard route')).toBeTruthy()
  })
})
