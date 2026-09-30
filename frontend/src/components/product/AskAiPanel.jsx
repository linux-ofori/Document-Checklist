import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Sparkles, X } from 'lucide-react'
import { ASSISTANT_SUGGESTIONS } from '../../data'
import { useAppData } from '../../hooks/useAppData'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { Button, IconButton, LoadingState } from '../ui'
import { formatRelativeTime } from '../../utils/format'
import { cn } from '../../utils/cn'

export function AskAiPanel() {
  const { assistant, openAssistant, closeAssistant, askAssistant } = useAppData()
  const [question, setQuestion] = useState('')
  const listRef = useRef(null)

  useBodyScrollLock(assistant.isOpen)

  useEffect(() => {
    if (!assistant.isOpen) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeAssistant()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [assistant.isOpen, closeAssistant])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [assistant.messages, assistant.isThinking])

  if (!assistant.isOpen) {
    return (
      <button type="button" className="ask-fab" onClick={openAssistant}>
        <Sparkles size={18} aria-hidden="true" />
        <span>Ask AI</span>
      </button>
    )
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!question.trim() || assistant.isThinking) return
    askAssistant(question)
    setQuestion('')
  }

  return (
    <aside className="ask-panel" aria-label="Ask AI assistant">
      <header className="ask-panel__header">
        <span className="ask-panel__icon" aria-hidden="true">
          <Bot size={18} />
        </span>
        <div className="ask-panel__heading">
          <p className="ask-panel__title">Ask AI</p>
          <p className="ui-caption">Answers come from your own checklists</p>
        </div>
        <IconButton label="Close Ask AI" onClick={closeAssistant}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </header>

      <div className="ask-panel__messages" ref={listRef} aria-live="polite">
        {assistant.messages.map((message) => (
          <div
            key={message.id}
            className={cn('ask-message', `ask-message--${message.role}`)}
          >
            {message.role === 'assistant' ? (
              <span className="ask-message__avatar" aria-hidden="true">
                <Sparkles size={14} />
              </span>
            ) : null}

            <div className="ask-message__body">
              {message.title ? <p className="ask-message__title">{message.title}</p> : null}
              <p className="ask-message__text">{message.body}</p>
              {message.followUp ? (
                <p className="ask-message__follow-up">{message.followUp}</p>
              ) : null}
              <span className="ui-caption">{formatRelativeTime(message.createdAt)}</span>
            </div>
          </div>
        ))}

        {assistant.isThinking ? (
          <LoadingState label="Reading your checklists" size="sm" />
        ) : null}
      </div>

      <div className="ask-panel__suggestions">
        {ASSISTANT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="ask-panel__chip"
            onClick={() => askAssistant(suggestion)}
            disabled={assistant.isThinking}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form className="ask-panel__form" onSubmit={handleSubmit}>
        <label className="ui-visually-hidden" htmlFor="ask-ai-input">
          Ask a question about your documents
        </label>
        <input
          id="ask-ai-input"
          className="ui-field__control"
          placeholder="Ask about a checklist, a document or a deadline"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          aria-label="Send question"
          disabled={!question.trim()}
          isLoading={assistant.isThinking}
        >
          <Send size={16} aria-hidden="true" />
        </Button>
      </form>
    </aside>
  )
}
