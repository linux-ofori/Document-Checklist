import { createId } from '../services'

export const LOGOUT_WARNING_MESSAGE =
  'You’re signed out on this device, but we couldn’t confirm server sign-out.'

export const ACTIONS = {
  HYDRATE: 'HYDRATE',
  HYDRATE_FAILED: 'HYDRATE_FAILED',
  AUTH_RESET: 'AUTH_RESET',
  REQUIREMENT_UPDATED: 'REQUIREMENT_UPDATED',
  APPLICATION_ADDED: 'APPLICATION_ADDED',
  APPLICATION_PATCHED: 'APPLICATION_PATCHED',
  DOCUMENT_ADDED: 'DOCUMENT_ADDED',
  DOCUMENT_PATCHED: 'DOCUMENT_PATCHED',
  DOCUMENT_REMOVED: 'DOCUMENT_REMOVED',
  NOTIFICATIONS_LOADING: 'NOTIFICATIONS_LOADING',
  NOTIFICATIONS_LOADED: 'NOTIFICATIONS_LOADED',
  NOTIFICATIONS_FAILED: 'NOTIFICATIONS_FAILED',
  NOTIFICATION_UPSERTED: 'NOTIFICATION_UPSERTED',
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
  error: null,
  processes: [],
  applications: [],
  documents: [],
  notifications: [],
  notificationsStatus: 'loading',
  notificationsError: null,
  notificationsRefreshing: false,
  notificationVersion: 0,
  notificationMutationVersions: {},
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
        error: null,
        processes: action.payload.processes,
        applications: action.payload.applications,
        documents: action.payload.documents,
        profile: action.payload.profile,
        assistant: { ...state.assistant, messages: [WELCOME_MESSAGE] },
      }

    case ACTIONS.HYDRATE_FAILED:
      return { ...state, status: 'error', error: action.payload }

    case ACTIONS.NOTIFICATIONS_LOADING:
      return {
        ...state,
        notificationsStatus: state.notificationsStatus === 'ready' ? 'ready' : 'loading',
        notificationsError: null,
        notificationsRefreshing: state.notificationsStatus === 'ready',
      }

    case ACTIONS.NOTIFICATIONS_LOADED:
      {
        const locallyChanged = state.notifications.filter(
          (notification) =>
            (state.notificationMutationVersions[notification.id] ?? 0)
            > action.payload.notificationVersion,
        )
        const changedById = new Map(
          locallyChanged.map((notification) => [notification.id, notification]),
        )
        const serverIds = new Set(action.payload.notifications.map((notification) => notification.id))
        const notifications = action.payload.notifications.map(
          (notification) => changedById.get(notification.id) ?? notification,
        )
        locallyChanged.forEach((notification) => {
          if (!serverIds.has(notification.id)) notifications.push(notification)
        })

        return {
          ...state,
          notifications,
          notificationsStatus: 'ready',
          notificationsError: null,
          notificationsRefreshing: false,
        }
      }

    case ACTIONS.NOTIFICATIONS_FAILED:
      return {
        ...state,
        notificationsStatus: state.notificationsStatus === 'ready' ? 'ready' : 'error',
        notificationsError: action.payload,
        notificationsRefreshing: false,
      }

    case ACTIONS.AUTH_RESET:
      return {
        ...INITIAL_STATE,
        toast: state.toast?.message === LOGOUT_WARNING_MESSAGE ? state.toast : null,
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

    case ACTIONS.NOTIFICATION_UPSERTED: {
      const existingIndex = state.notifications.findIndex(
        (notification) => notification.id === action.payload.id,
      )
      const notifications = [...state.notifications]
      if (existingIndex === -1) {
        notifications.push(action.payload)
      } else {
        notifications[existingIndex] = action.payload
      }
      const notificationVersion = state.notificationVersion + 1
      return {
        ...state,
        notifications,
        notificationVersion,
        notificationMutationVersions: {
          ...state.notificationMutationVersions,
          [action.payload.id]: notificationVersion,
        },
      }
    }

    case ACTIONS.NOTIFICATIONS_READ_ALL: {
      const notificationVersion = state.notificationVersion + 1
      const changedIds = []
      const readIds = new Set(action.payload)
      const notifications = state.notifications.map((notification) => {
        if (!notification.isRead && readIds.has(notification.id)) {
          changedIds.push(notification.id)
          return { ...notification, isRead: true }
        }
        return notification
      })
      const notificationMutationVersions = { ...state.notificationMutationVersions }
      changedIds.forEach((id) => {
        notificationMutationVersions[id] = notificationVersion
      })
      return {
        ...state,
        notifications,
        notificationVersion: changedIds.length > 0 ? notificationVersion : state.notificationVersion,
        notificationMutationVersions,
      }
    }

    case ACTIONS.PROFILE_PATCHED:
      return {
        ...state,
        profile: {
          ...state.profile,
          ...action.payload,
          ...(action.payload.preferences
            ? {
                preferences: {
                  ...state.profile?.preferences,
                  ...action.payload.preferences,
                },
              }
            : {}),
        },
      }

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
