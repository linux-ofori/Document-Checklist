import { request } from './client'

export function logout() {
  return request('auth/logout', { method: 'POST' })
}
