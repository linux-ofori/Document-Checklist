import { request } from './client'

const LOGOUT_TIMEOUT_MS = 5000

export function logout() {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS)

  return request('auth/logout', {
    method: 'POST',
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId))
}

export function requestPasswordReset(email) {
  return request('auth/password-reset/request', {
    method: 'POST',
    body: { email },
  })
}

export function confirmPasswordReset({ token, password }) {
  return request('auth/password-reset/confirm', {
    method: 'POST',
    body: { token, password },
  })
}

export function requestEmailVerification() {
  return request('auth/email-verification/request', { method: 'POST' })
}

export function confirmEmailVerification(token) {
  return request('auth/email-verification/confirm', {
    method: 'POST',
    body: { token },
  })
}

export function requestGoogleAuthorization({ intent, currentPassword } = {}) {
  return request('auth/google/authorization', {
    method: 'POST',
    credentials: 'include',
    body: {
      intent,
      ...(currentPassword === undefined ? {} : { currentPassword }),
    },
  })
}

export function exchangeGoogleTicket(ticket) {
  return request('auth/google/exchange', {
    method: 'POST',
    body: { ticket },
  })
}
