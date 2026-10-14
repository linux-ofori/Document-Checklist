import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthProvider'
import { clearAuthToken, hasAuthToken, request, storeAuthToken } from '../services'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('../services', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, request: requestMock }
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderAuthProvider() {
  let auth
  function CaptureAuth() {
    auth = useAuth()
    return (
      <output data-testid="auth-state">
        {JSON.stringify({ status: auth.status, user: auth.user, error: auth.error })}
      </output>
    )
  }

  const view = render(
    <AuthProvider>
      <CaptureAuth />
    </AuthProvider>,
  )

  return { ...view, getAuth: () => auth }
}

function authError(status, message = 'Request failed') {
  const error = new Error(message)
  if (status !== undefined) error.status = status
  return error
}

async function renderAuthenticatedUser(user = { id: 'user-one', email: 'one@example.test' }) {
  requestMock.mockResolvedValueOnce({ user })
  const provider = renderAuthProvider()
  await waitFor(() => expect(provider.getAuth().status).toBe('authenticated'))
  return provider
}

beforeEach(() => {
  clearAuthToken()
  requestMock.mockReset()
})

afterEach(() => {
  cleanup()
  clearAuthToken()
  vi.restoreAllMocks()
})

describe('AuthProvider', () => {
  it('becomes unauthenticated without requesting a session when no token is stored', async () => {
    const provider = renderAuthProvider()

    await waitFor(() => {
      expect(provider.getAuth().status).toBe('unauthenticated')
    })

    expect(provider.getAuth().user).toBeNull()
    expect(provider.getAuth().error).toBe('')
    expect(request).not.toHaveBeenCalled()
    expect(hasAuthToken()).toBe(false)
  })

  it('shows the checking state until a stored session is verified', async () => {
    const session = deferred()
    storeAuthToken('stored-token')
    requestMock.mockReturnValueOnce(session.promise)

    const provider = renderAuthProvider()

    expect(provider.getAuth().status).toBe('checking')
    expect(request).toHaveBeenCalledWith('auth/me')

    await act(async () => {
      session.resolve({ user: { id: 'user-one', email: 'one@example.test' } })
      await session.promise
    })

    expect(provider.getAuth().status).toBe('authenticated')
    expect(provider.getAuth().user).toEqual({ id: 'user-one', email: 'one@example.test' })
    expect(hasAuthToken()).toBe(true)
  })

  it('clears the stored token after initial session verification returns 401', async () => {
    storeAuthToken('expired-token')
    requestMock.mockRejectedValueOnce(authError(401, 'Unauthorized'))

    const provider = renderAuthProvider()

    await waitFor(() => expect(provider.getAuth().status).toBe('unauthenticated'))

    expect(provider.getAuth().user).toBeNull()
    expect(hasAuthToken()).toBe(false)
  })

  it.each([
    ['a network error', new TypeError('Network unavailable')],
    ['a non-401 server error', authError(503, 'Service unavailable')],
  ])('preserves the stored token and reports an error for initial verification with %s', async (_label, error) => {
    storeAuthToken('stored-token')
    requestMock.mockRejectedValueOnce(error)

    const provider = renderAuthProvider()

    await waitFor(() => expect(provider.getAuth().status).toBe('error'))

    expect(provider.getAuth().user).toBeNull()
    expect(provider.getAuth().error).toBe('We could not verify your session. Check your connection and try again.')
    expect(hasAuthToken()).toBe(true)
  })

  it('clears the current session and token when refreshUser receives 401', async () => {
    storeAuthToken('stored-token')
    const provider = await renderAuthenticatedUser()
    const error = authError(401, 'Unauthorized')
    requestMock.mockRejectedValueOnce(error)

    let refreshPromise
    act(() => {
      refreshPromise = provider.getAuth().refreshUser()
    })
    await expect(refreshPromise).rejects.toBe(error)

    await waitFor(() => expect(provider.getAuth().status).toBe('unauthenticated'))
    expect(provider.getAuth().user).toBeNull()
    expect(provider.getAuth().error).toBe('')
    expect(hasAuthToken()).toBe(false)
  })

  it.each([
    ['a network error', new TypeError('Network unavailable')],
    ['a non-401 server error', authError(503, 'Service unavailable')],
  ])('rethrows %s from refreshUser without logging out the current user', async (_label, error) => {
    storeAuthToken('stored-token')
    const provider = await renderAuthenticatedUser()
    requestMock.mockRejectedValueOnce(error)

    await expect(provider.getAuth().refreshUser()).rejects.toBe(error)

    expect(provider.getAuth().status).toBe('authenticated')
    expect(provider.getAuth().user).toEqual({ id: 'user-one', email: 'one@example.test' })
    expect(hasAuthToken()).toBe(true)
  })

  it('does not let a stale successful refresh overwrite a newer authenticated user', async () => {
    storeAuthToken('stored-token')
    const provider = await renderAuthenticatedUser()
    const refresh = deferred()
    requestMock.mockReturnValueOnce(refresh.promise)

    let refreshPromise
    act(() => {
      refreshPromise = provider.getAuth().refreshUser()
    })
    const newerUser = { id: 'user-two', email: 'two@example.test' }
    act(() => provider.getAuth().authenticate(newerUser))

    await act(async () => {
      refresh.resolve({ user: { id: 'user-three', email: 'three@example.test' } })
      await refreshPromise
    })

    expect(provider.getAuth().status).toBe('authenticated')
    expect(provider.getAuth().user).toEqual(newerUser)
    expect(hasAuthToken()).toBe(true)
  })

  it('does not let a stale refresh 401 sign out a newer session', async () => {
    storeAuthToken('stored-token')
    const provider = await renderAuthenticatedUser()
    const refresh = deferred()
    requestMock.mockReturnValueOnce(refresh.promise)

    let refreshPromise
    act(() => {
      refreshPromise = provider.getAuth().refreshUser()
    })
    const newerUser = { id: 'user-two', email: 'two@example.test' }
    act(() => provider.getAuth().authenticate(newerUser))

    const unauthorized = authError(401, 'Unauthorized')
    await act(async () => {
      refresh.reject(unauthorized)
      await expect(refreshPromise).rejects.toBe(unauthorized)
    })

    expect(provider.getAuth().status).toBe('authenticated')
    expect(provider.getAuth().user).toEqual(newerUser)
    expect(hasAuthToken()).toBe(true)
  })

  it('does not restore a session when a successful refresh resolves after sign-out', async () => {
    storeAuthToken('stored-token')
    const provider = await renderAuthenticatedUser()
    const refresh = deferred()
    requestMock.mockReturnValueOnce(refresh.promise)

    let refreshPromise
    act(() => {
      refreshPromise = provider.getAuth().refreshUser()
    })
    act(() => provider.getAuth().signOut())

    await act(async () => {
      refresh.resolve({ user: { id: 'user-one', email: 'one@example.test' } })
      await refreshPromise
    })

    expect(provider.getAuth().status).toBe('unauthenticated')
    expect(provider.getAuth().user).toBeNull()
    expect(provider.getAuth().error).toBe('')
    expect(hasAuthToken()).toBe(false)
  })

  it('signs out locally and clears the token without calling the server logout endpoint', async () => {
    storeAuthToken('stored-token')
    const provider = await renderAuthenticatedUser()

    act(() => provider.getAuth().signOut())

    expect(provider.getAuth().status).toBe('unauthenticated')
    expect(provider.getAuth().user).toBeNull()
    expect(provider.getAuth().error).toBe('')
    expect(hasAuthToken()).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('auth/me')
  })

  it('does not let a stale initial success replace a newer authenticated user', async () => {
    const session = deferred()
    storeAuthToken('stored-token')
    requestMock.mockReturnValueOnce(session.promise)

    const provider = renderAuthProvider()
    const newerUser = { id: 'user-two', email: 'two@example.test' }
    act(() => provider.getAuth().authenticate(newerUser))

    await act(async () => {
      session.resolve({ user: { id: 'user-one', email: 'one@example.test' } })
      await session.promise
    })

    expect(provider.getAuth().status).toBe('authenticated')
    expect(provider.getAuth().user).toEqual(newerUser)
  })

  it('does not let a stale initial 401 sign out a newer authenticated user', async () => {
    const session = deferred()
    storeAuthToken('stored-token')
    requestMock.mockReturnValueOnce(session.promise)

    const provider = renderAuthProvider()
    const newerUser = { id: 'user-two', email: 'two@example.test' }
    act(() => provider.getAuth().authenticate(newerUser))

    await act(async () => {
      session.reject(authError(401, 'Unauthorized'))
      await session.promise.catch(() => {})
    })

    expect(provider.getAuth().status).toBe('authenticated')
    expect(provider.getAuth().user).toEqual(newerUser)
    expect(hasAuthToken()).toBe(true)
  })

  it('invalidates pending session verification when signing out', async () => {
    const session = deferred()
    storeAuthToken('stored-token')
    requestMock.mockReturnValueOnce(session.promise)

    const provider = renderAuthProvider()
    act(() => provider.getAuth().signOut())

    await act(async () => {
      session.resolve({ user: { id: 'user-one', email: 'one@example.test' } })
      await session.promise
    })

    expect(provider.getAuth().status).toBe('unauthenticated')
    expect(provider.getAuth().user).toBeNull()
    expect(hasAuthToken()).toBe(false)
  })
})
