import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './client'
import { askAssistantQuestion } from './assistantService'

vi.mock('./client', () => ({
  request: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('askAssistantQuestion', () => {
  it('posts the message, optional application ID, and abort signal using request', async () => {
    const signal = new AbortController().signal
    request.mockResolvedValue({
      answer: '  Gather the required documents. ',
      sources: [{ type: 'requirement', label: '  Proof of identity  ' }],
    })

    await expect(askAssistantQuestion({
      message: 'What do I need?',
      applicationId: 'app-123',
      signal,
    })).resolves.toEqual({
      answer: 'Gather the required documents.',
      sources: [{ type: 'requirement', label: 'Proof of identity' }],
    })

    expect(request).toHaveBeenCalledWith('assistant/ask', {
      method: 'POST',
      body: { message: 'What do I need?', applicationId: 'app-123' },
      signal,
    })
  })

  it('omits applicationId for general questions', async () => {
    request.mockResolvedValue({ answer: 'An answer.', sources: [] })

    await askAssistantQuestion({ message: 'General question' })

    expect(request).toHaveBeenCalledWith('assistant/ask', {
      method: 'POST',
      body: { message: 'General question' },
      signal: undefined,
    })
  })

  it.each([
    ['missing answer', { sources: [] }],
    ['empty answer', { answer: '   ', sources: [] }],
    ['oversized answer', { answer: 'a'.repeat(4001), sources: [] }],
    ['missing sources', { answer: 'Answer' }],
    ['non-array sources', { answer: 'Answer', sources: {} }],
    ['more than ten sources', {
      answer: 'Answer',
      sources: Array.from({ length: 11 }, () => ({ type: 'expiry', label: 'Expiry' })),
    }],
    ['invalid source type', {
      answer: 'Answer',
      sources: [{ type: 'document', label: 'Document' }],
    }],
    ['empty source label', {
      answer: 'Answer',
      sources: [{ type: 'requirement', label: ' ' }],
    }],
    ['extra source properties', {
      answer: 'Answer',
      sources: [{ type: 'requirement', label: 'Identity', url: 'https://example.test' }],
    }],
  ])('rejects %s with a safe generic error', async (_description, payload) => {
    request.mockResolvedValue(payload)

    await expect(askAssistantQuestion({ message: 'Question' }))
      .rejects.toThrow('The assistant returned an invalid response.')
  })
})
