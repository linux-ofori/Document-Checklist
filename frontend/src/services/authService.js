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
