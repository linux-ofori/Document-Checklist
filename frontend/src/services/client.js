const DEFAULT_LATENCY_MS = 380
const SLOW_LATENCY_MS = 720

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
