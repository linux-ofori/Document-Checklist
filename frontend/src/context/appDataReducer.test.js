import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services', () => ({
  createId: vi.fn(() => 'toast-test-id'),
}))

import { ACTIONS, appDataReducer, INITIAL_STATE } from './appDataReducer'

afterEach(() => {
  vi.clearAllMocks()
})

describe('assistant reducer state', () => {
  it('initializes without an open or pending conversation', () => {
    expect(INITIAL_STATE.assistant).toEqual({
      isOpen: false,
      isThinking: false,
      messages: [],
      applicationId: null,
      error: null,
    })
  })

  it('opens with the requested context and clears an old error', () => {
    const state = {
      ...INITIAL_STATE,
      assistant: { ...INITIAL_STATE.assistant, error: 'Previous error' },
    }

    expect(appDataReducer(state, {
      type: ACTIONS.ASSISTANT_OPENED,
      payload: { applicationId: 'app-123' },
    }).assistant).toMatchObject({
      isOpen: true,
      applicationId: 'app-123',
      error: null,
    })

    expect(appDataReducer(state, {
      type: ACTIONS.ASSISTANT_OPENED,
    }).assistant.applicationId).toBeNull()
  })

  it('closes and clears loading and error state', () => {
    const state = {
      ...INITIAL_STATE,
      assistant: {
        ...INITIAL_STATE.assistant,
        isOpen: true,
        isThinking: true,
        error: 'Previous error',
      },
    }

    expect(appDataReducer(state, { type: ACTIONS.ASSISTANT_CLOSED }).assistant)
      .toMatchObject({ isOpen: false, isThinking: false, error: null })
  })

  it('clears all assistant state during authentication reset', () => {
    const state = {
      ...INITIAL_STATE,
      assistant: {
        ...INITIAL_STATE.assistant,
        isOpen: true,
        isThinking: true,
        messages: [{ id: 'answer', role: 'assistant', body: 'Private answer' }],
        applicationId: 'app-123',
        error: 'Request failed',
      },
    }

    expect(appDataReducer(state, {
      type: ACTIONS.AUTH_RESET,
      payload: { sessionId: null, sessionGeneration: 3 },
    })).toMatchObject({
      sessionId: null,
      sessionGeneration: 3,
      assistant: INITIAL_STATE.assistant,
    })
  })
})
