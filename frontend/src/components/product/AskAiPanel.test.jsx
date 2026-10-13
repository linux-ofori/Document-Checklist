import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskAiPanel } from './AskAiPanel'

const panelHarness = vi.hoisted(() => ({
  context: null,
}))

vi.mock('../../hooks/useAppData', () => ({
  useAppData: () => panelHarness.context,
}))

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}))

afterEach(() => {
  cleanup()
})

function renderOpenPanel(overrides = {}) {
  panelHarness.context = {
    assistant: {
      isOpen: true,
      isThinking: false,
      messages: [],
      error: null,
      ...overrides.assistant,
    },
    openAssistant: vi.fn(),
    closeAssistant: vi.fn(),
    askAssistant: vi.fn(),
    ...overrides.context,
  }

  return {
    ...render(<AskAiPanel />),
    context: panelHarness.context,
  }
}

describe('AskAiPanel', () => {
  it('limits the question input to 2,000 characters and allows retry from an error state', () => {
    const { context } = renderOpenPanel({
      assistant: { error: 'The assistant is temporarily unavailable.' },
    })
    const input = screen.getByLabelText('Ask a question about your documents')

    expect(input.getAttribute('maxLength')).toBe('2000')
    expect(screen.getByText('The assistant is temporarily unavailable.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send question' }).disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'Try again' } })
    expect(screen.getByRole('button', { name: 'Send question' }).disabled).toBe(false)
    fireEvent.submit(input.closest('form'))

    expect(context.askAssistant).toHaveBeenCalledWith('Try again')
  })

  it('renders answer and source content as plain text, not links or HTML', () => {
    const answer = '<img src=x onerror=alert(1)> https://example.test/path'
    const sourceLabel = '<a href="javascript:alert(1)">Checklist item</a>'
    const { container } = renderOpenPanel({
      assistant: {
        messages: [{
          id: 'assistant-answer',
          role: 'assistant',
          body: answer,
          sources: [{ type: 'requirement', label: sourceLabel }],
          createdAt: new Date().toISOString(),
        }],
      },
    })

    expect(screen.getByText(answer)).toBeTruthy()
    expect(screen.getByText(`Sources: ${sourceLabel}`)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })
})
