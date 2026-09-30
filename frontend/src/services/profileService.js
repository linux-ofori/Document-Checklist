import { PROFILE } from '../data'
import { resolveAfter, resolvePayload } from './client'

export function fetchProfile() {
  return resolvePayload(PROFILE, 300)
}

export function saveProfile(patch) {
  return resolveAfter(520).then(() => patch)
}

export function savePassword() {
  return resolveAfter(640).then(() => ({ updated: true, changedAt: new Date().toISOString() }))
}

export function savePreferences(preferences) {
  return resolveAfter(260).then(() => preferences)
}
