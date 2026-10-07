const DEFAULT_LATENCY_MS = 380
const SLOW_LATENCY_MS = 720
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/+$/, '')
const AUTH_TOKEN_STORAGE_KEY = 'document-checklist-token'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
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

export async function request(path, options = {}) {
  const { token: providedToken, headers: requestHeaders, body, ...fetchOptions } = options
  const headers = new Headers(requestHeaders)
  let requestBody = body

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }

  let token = providedToken
  if (token === undefined && typeof window !== 'undefined') {
    token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
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
  const responseText = await response.text()
  let payload = null

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
    throw error
  }

  return payload
}
