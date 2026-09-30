import { createId } from '../services'

export const ACTIONS = {
  HYDRATE: 'HYDRATE',
  REQUIREMENT_UPDATED: 'REQUIREMENT_UPDATED',
  APPLICATION_ADDED: 'APPLICATION_ADDED',
  APPLICATION_PATCHED: 'APPLICATION_PATCHED',
  DOCUMENT_ADDED: 'DOCUMENT_ADDED',
  DOCUMENT_PATCHED: 'DOCUMENT_PATCHED',
  DOCUMENT_REMOVED: 'DOCUMENT_REMOVED',
  NOTIFICATION_READ: 'NOTIFICATION_READ',
  NOTIFICATIONS_READ_ALL: 'NOTIFICATIONS_READ_ALL',
  PROFILE_PATCHED: 'PROFILE_PATCHED',
  UPLOAD_OPENED: 'UPLOAD_OPENED',
  UPLOAD_CLOSED: 'UPLOAD_CLOSED',
  UPLOAD_STATE: 'UPLOAD_STATE',
  ASSISTANT_OPENED: 'ASSISTANT_OPENED',
  ASSISTANT_CLOSED: 'ASSISTANT_CLOSED',
  ASSISTANT_STATE: 'ASSISTANT_STATE',
  ASSISTANT_MESSAGE: 'ASSISTANT_MESSAGE',
  TOAST_SHOWN: 'TOAST_SHOWN',
  TOAST_HIDDEN: 'TOAST_HIDDEN',
  PREVIEW_OPENED: 'PREVIEW_OPENED',
  PREVIEW_CLOSED: 'PREVIEW_CLOSED',
}

export const INITIAL_STATE = {
  status: 'loading',
  processes: [],
  applications: [],
  documents: [],
  notifications: [],
  profile: null,
  upload: { isOpen: false, prefill: null, isSubmitting: false },
  assistant: { isOpen: false, isThinking: false, messages: [] },
  preview: { isOpen: false, documentId: null },
  toast: null,
}

const WELCOME_MESSAGE = {
  id: 'assistant-welcome',
  role: 'assistant',
  title: 'Ask me about your paperwork',
  body: 'I can read your checklists, tell you what is still missing, and point out anything that is about to expire. Nothing you ask leaves this device.',
  followUp: 'Try one of the suggestions below to get started.',
  createdAt: '2026-09-30T06:45:00.000Z',
}

function touchApplication(applications, applicationId, patch) {
  return applications.map((application) =>
    application.id === applicationId
      ? { ...application, ...patch, updatedAt: new Date().toISOString() }
      : application,
  )
}

function updateRequirement(applications, applicationId, requirementKey, patch) {
  return applications.map((application) => {
    if (application.id !== applicationId) return application

    const requirements = (application.requirements ?? []).map((entry) =>
      entry.key === requirementKey ? { ...entry, ...patch } : entry,
    )

    return { ...application, requirements, updatedAt: new Date().toISOString() }
  })
}

export function appDataReducer(state, action) {
  switch (action.type) {
    case ACTIONS.HYDRATE:
      return {
        ...state,
        status: 'ready',
        processes: action.payload.processes,
        applications: action.payload.applications,
        documents: action.payload.documents,
        notifications: action.payload.notifications,
        profile: action.payload.profile,
        assistant: { ...state.assistant, messages: [WELCOME_MESSAGE] },
      }

    case ACTIONS.REQUIREMENT_UPDATED:
      return {
        ...state,
        applications: updateRequirement(
          state.applications,
          action.payload.applicationId,
          action.payload.requirementKey,
          action.payload.patch,
        ),
      }

    case ACTIONS.APPLICATION_ADDED:
      return { ...state, applications: [action.payload, ...state.applications] }

    case ACTIONS.APPLICATION_PATCHED:
      return {
        ...state,
        applications: touchApplication(state.applications, action.payload.id, action.payload.patch),
      }

    case ACTIONS.DOCUMENT_ADDED:
      return { ...state, documents: [action.payload, ...state.documents] }

    case ACTIONS.DOCUMENT_PATCHED:
      return {
        ...state,
        documents: state.documents.map((document) =>
          document.id === action.payload.id ? { ...document, ...action.payload.patch } : document,
        ),
      }

    case ACTIONS.DOCUMENT_REMOVED:
      return {
        ...state,
        documents: state.documents.filter((document) => document.id !== action.payload),
      }

    case ACTIONS.NOTIFICATION_READ:
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.payload ? { ...notification, isRead: true } : notification,
        ),
      }

    case ACTIONS.NOTIFICATIONS_READ_ALL:
      return {
        ...state,
        notifications: state.notifications.map((notification) => ({ ...notification, isRead: true })),
      }

    case ACTIONS.PROFILE_PATCHED:
      return { ...state, profile: { ...state.profile, ...action.payload } }

    case ACTIONS.UPLOAD_OPENED:
      return { ...state, upload: { isOpen: true, prefill: action.payload, isSubmitting: false } }

    case ACTIONS.UPLOAD_CLOSED:
      return { ...state, upload: { isOpen: false, prefill: null, isSubmitting: false } }

    case ACTIONS.UPLOAD_STATE:
      return { ...state, upload: { ...state.upload, ...action.payload } }

    case ACTIONS.ASSISTANT_OPENED:
      return { ...state, assistant: { ...state.assistant, isOpen: true } }

    case ACTIONS.ASSISTANT_CLOSED:
      return { ...state, assistant: { ...state.assistant, isOpen: false, isThinking: false } }

    case ACTIONS.ASSISTANT_STATE:
      return { ...state, assistant: { ...state.assistant, ...action.payload } }

    case ACTIONS.ASSISTANT_MESSAGE:
      return {
        ...state,
        assistant: { ...state.assistant, messages: [...state.assistant.messages, action.payload] },
      }

    case ACTIONS.TOAST_SHOWN:
      return { ...state, toast: { id: createId('toast'), ...action.payload } }

    case ACTIONS.TOAST_HIDDEN:
      return { ...state, toast: null }

    case ACTIONS.PREVIEW_OPENED:
      return { ...state, preview: { isOpen: true, documentId: action.payload } }

    case ACTIONS.PREVIEW_CLOSED:
      return { ...state, preview: { isOpen: false, documentId: null } }

    default:
      return state
  }
}
