import { request } from './client'

function isAssistantSource(source) {
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && Object.keys(source).length === 2
    && (source.type === 'requirement' || source.type === 'expiry')
    && typeof source.label === 'string'
    && source.label.trim(),
  )
}

export async function askAssistantQuestion({ message, applicationId, signal }) {
  const body = { message }
  if (applicationId !== undefined && applicationId !== null) {
    body.applicationId = applicationId
  }

  const payload = await request('assistant/ask', {
    method: 'POST',
    body,
    signal,
  })

  if (
    typeof payload?.answer !== 'string'
    || !payload.answer.trim()
    || payload.answer.length > 4000
    || !Array.isArray(payload.sources)
    || payload.sources.length > 10
    || !payload.sources.every(isAssistantSource)
  ) {
    throw new Error('The assistant returned an invalid response.')
  }

  return {
    answer: payload.answer.trim(),
    sources: payload.sources.map((source) => ({
      type: source.type,
      label: source.label.trim(),
    })),
  }
}
