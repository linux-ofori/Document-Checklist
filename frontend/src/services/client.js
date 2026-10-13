const DEFAULT_LATENCY_MS = 380
const SLOW_LATENCY_MS = 720
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/+$/, '')
const AUTH_TOKEN_STORAGE_KEY = 'document-checklist-token'
const AUTH_TOKEN_INVALID_KEY = 'document-checklist-token-invalid'
const GOOGLE_REMEMBER_STORAGE_KEY = 'document-checklist-google-remember'
let authTokenStorageInvalid = false

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function readAuthStorage(getStorage) {
  let storage
  try {
    storage = getStorage()
  } catch {
    return { ok: false }
  }

  let ok = true
  let token = null
  let invalid = null
  try {
    token = storage.getItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    ok = false
  }
  try {
    invalid = storage.getItem(AUTH_TOKEN_INVALID_KEY)
  } catch {
    ok = false
  }
  return { ok, token, invalid }
}

function clearAuthStorage(getStorage) {
  let storage
  try {
    storage = getStorage()
  } catch {
    return false
  }

  let cleared = true
  try {
    storage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    cleared = false
  }
  try {
    storage.removeItem(AUTH_TOKEN_INVALID_KEY)
  } catch {
    cleared = false
  }
  return cleared
}

function markAuthTokenStorageInvalid() {
  authTokenStorageInvalid = true
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      getStorage().setItem(AUTH_TOKEN_INVALID_KEY, 'true')
    } catch {
      // Continue attempting to mark the other storage area.
    }
  }
}

function readAuthTokenState() {
  if (authTokenStorageInvalid) return null
  if (typeof window === 'undefined') return { token: null, persistent: false }
  const session = readAuthStorage(() => window.sessionStorage)
  const local = readAuthStorage(() => window.localStorage)

  if (!session.ok || !local.ok) return null
  if (session.invalid === 'true' || local.invalid === 'true') return null
  if (session.token && local.token && session.token !== local.token) return null
  return {
    token: session.token || local.token || null,
    persistent: Boolean(local.token && !session.token),
  }
}

function readAuthToken() {
  return readAuthTokenState()?.token ?? null
}

export function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

export function resolvePayload(payload, latencyMs) {
  const wait = latencyMs ?? DEFAULT_LATENCY_MS

  return new Promise((resolve) => {
    window.setTimeout(() => resolve(clone(payload)), wait)
  })
}

export function resolveAfter(latencyMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, latencyMs ?? SLOW_LATENCY_MS)
  })
}

export function storeAuthToken(token, remember = true) {
  if (typeof token !== 'string' || !token || typeof window === 'undefined') {
    return false
  }

  let cleared = true
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    if (!clearAuthStorage(getStorage)) cleared = false
  }
  if (!cleared) {
    markAuthTokenStorageInvalid()
    return false
  }

  try {
    const storage = remember ? window.localStorage : window.sessionStorage
    storage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
    const stored = storage.getItem(AUTH_TOKEN_STORAGE_KEY) === token
    if (stored) {
      authTokenStorageInvalid = false
    } else {
      markAuthTokenStorageInvalid()
    }
    return stored
  } catch {
    markAuthTokenStorageInvalid()
    return false
  }
}

export function storeGoogleRememberPreference(remember) {
  if (typeof window === 'undefined') return false
  try {
    window.sessionStorage.setItem(GOOGLE_REMEMBER_STORAGE_KEY, remember ? 'true' : 'false')
    return true
  } catch {
    return false
  }
}

export function consumeGoogleRememberPreference() {
  if (typeof window === 'undefined') return true
  let preference
  try {
    preference = window.sessionStorage.getItem(GOOGLE_REMEMBER_STORAGE_KEY)
  } catch {
    return false
  }
  try {
    window.sessionStorage.removeItem(GOOGLE_REMEMBER_STORAGE_KEY)
  } catch {
    return preference !== 'false'
  }
  return preference !== 'false'
}

export function hasPersistentAuthToken() {
  return readAuthTokenState()?.persistent ?? false
}

export function hasAuthToken() {
  return Boolean(readAuthToken())
}

export function clearAuthToken() {
  if (typeof window === 'undefined') {
    return false
  }

  let cleared = true
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    if (!clearAuthStorage(getStorage)) cleared = false
  }
  if (cleared) {
    authTokenStorageInvalid = false
  } else {
    markAuthTokenStorageInvalid()
  }
  return cleared
}

export async function request(path, options = {}) {
  const {
    token: providedToken,
    headers: requestHeaders,
    body,
    responseType = 'json',
    ...fetchOptions
  } = options
  const headers = new Headers(requestHeaders)
  let requestBody = body

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  if (isFormData) {
    headers.delete('Content-Type')
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }

  let token = providedToken
  if (token === undefined && typeof window !== 'undefined') {
    token = readAuthToken()
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const relativePath = path.replace(/^\/+/, '')
  const response = await fetch(`${API_BASE_URL}/${relativePath}`, {
    ...fetchOptions,
    headers,
    ...(body === undefined ? {} : { body: requestBody }),
  })
  let payload

  if (response.ok && responseType === 'blob') {
    return response.blob()
  }

  const responseText = await response.text()
  payload = null
  if (responseText) {
    try {
      payload = JSON.parse(responseText)
    } catch {
      payload = responseText
    }
  }

  if (!response.ok) {
    const message = typeof payload?.error === 'string' && payload.error
      ? payload.error
      : `Request failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`
    const error = new Error(message)
    error.status = response.status
    if (Array.isArray(payload?.details)) {
      error.details = payload.details
    }
    throw error
  }

  return payload
}
