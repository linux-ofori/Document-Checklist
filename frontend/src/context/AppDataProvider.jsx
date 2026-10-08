import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useAuth } from './AuthProvider'
import {
  fetchApplications,
  fetchDocuments,
  fetchNotifications,
  fetchProcesses,
  isNotification,
  readAllNotifications,
  readNotification,
  removeDocumentRecord,
  savePassword,
  savePreferences,
  saveProfile,
  updateDocumentRecord,
  uploadDocument,
  replaceDocumentFile,
  createApplicationRecord,
  saveRequirementStatus,
  storeAuthToken,
} from '../services'
import { findAssistantAnswer } from '../data'
import {
  buildApplicationView,
  buildDashboardStats,
  buildDocumentView,
  buildNotificationView,
  buildRequirements,
  sortByCreatedAtDesc,
  sortByUpdatedAtDesc,
} from '../utils/selectors'
import { findRequirementByType } from '../utils/checklist'
import { AppDataContext } from './AppDataContext'
import { ACTIONS, INITIAL_STATE, appDataReducer } from './appDataReducer'
import { GlobalOverlays } from '../components/product/GlobalOverlays'

function normalizeProfile(user, existingProfile = {}) {
  const preferences = {
    ...existingProfile.preferences,
    ...user?.preferences?.notifications,
  }

  return {
    ...existingProfile,
    ...user,
    preferences: {
      documentExpiry: typeof preferences.documentExpiry === 'boolean'
        ? preferences.documentExpiry
        : true,
      applicationUpdates: typeof preferences.applicationUpdates === 'boolean'
        ? preferences.applicationUpdates
        : true,
      securityAccount: true,
    },
  }
}

function safeAccountError(error, operation) {
  if (error?.code === 'TOKEN_STORAGE_FAILED') {
    return error.message
  }

  if (error?.status === 400) {
    return operation === 'password'
      ? 'The new password does not meet the requirements.'
      : 'Please check the information and try again.'
  }
  if (error?.status === 401) {
    return operation === 'password'
      ? 'The current password is incorrect or your session has expired.'
      : 'Your session has expired. Please sign in again.'
  }
  if (error?.status === 409) {
    if (operation === 'profile') return 'That email address is already in use.'
    return operation === 'password'
      ? 'We could not change your password. Please try again.'
      : 'We could not save your notification preferences. Please try again.'
  }
  if (error?.status === 429) return 'Too many attempts. Please wait and try again later.'
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection and try again.'
  return operation === 'password'
    ? 'We could not change your password. Please try again.'
    : 'We could not save your account changes. Please try again.'
}

export function AppDataProvider({ children }) {
  const [state, dispatch] = useReducer(appDataReducer, INITIAL_STATE)
  const [hydrationRetry, setHydrationRetry] = useState(0)
  const [notificationRetry, setNotificationRetry] = useState(0)
  const { status: authStatus, user, updateUser, signOut } = useAuth()
  const hydrationRef = useRef({ sessionId: null, promise: null })
  const sessionId = user?.id ?? user?.email ?? null
  const authSessionRef = useRef({ authStatus, sessionId, generation: 0 })
  const notificationVersionRef = useRef(state.notificationVersion)

  useLayoutEffect(() => {
    if (
      authSessionRef.current.authStatus !== authStatus
      || authSessionRef.current.sessionId !== sessionId
    ) {
      authSessionRef.current = {
        authStatus,
        sessionId,
        generation: authSessionRef.current.generation + 1,
      }
    }
  }, [authStatus, sessionId])

  useLayoutEffect(() => {
    notificationVersionRef.current = state.notificationVersion
  }, [state.notificationVersion])

  const isCurrentSession = useCallback(
    (generation) =>
      authSessionRef.current.authStatus === 'authenticated'
      && authSessionRef.current.generation === generation,
    [],
  )

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      hydrationRef.current = { sessionId: null, promise: null }
      setHydrationRetry(0)
      dispatch({ type: ACTIONS.AUTH_RESET })
      return undefined
    }

    if (authStatus !== 'authenticated') return undefined

    if (hydrationRef.current.sessionId !== sessionId) {
      hydrationRef.current = { sessionId, promise: null }
      dispatch({ type: ACTIONS.AUTH_RESET })
    } else if (hydrationRef.current.promise) {
      return undefined
    }

    if (!hydrationRef.current.promise) {
      const hydrationPromise = Promise.all([
        fetchProcesses(),
        fetchApplications(),
        fetchDocuments(),
      ])
        .then(([processes, applications, documents]) => ({
          processes,
          applications,
          documents,
          profile: normalizeProfile(user),
        }))
        .catch((error) => {
          if (hydrationRef.current.promise === hydrationPromise) {
            hydrationRef.current.promise = null
          }
          throw error
        })
      hydrationRef.current.promise = hydrationPromise
    }

    let isActive = true
    hydrationRef.current.promise
      .then((payload) => {
        if (isActive) dispatch({ type: ACTIONS.HYDRATE, payload })
      })
      .catch((error) => {
        if (!isActive) return
        dispatch({
          type: ACTIONS.HYDRATE_FAILED,
          payload: error instanceof Error ? error.message : 'We could not load your account data.',
        })
      })

    return () => {
      isActive = false
    }
  }, [authStatus, hydrationRetry, sessionId, user])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined

    let isActive = true
    const requestSessionGeneration = authSessionRef.current.generation
    const notificationVersion = notificationVersionRef.current
    dispatch({ type: ACTIONS.NOTIFICATIONS_LOADING })
    fetchNotifications()
      .then((notifications) => {
        if (isActive && isCurrentSession(requestSessionGeneration)) {
          dispatch({
            type: ACTIONS.NOTIFICATIONS_LOADED,
            payload: { notifications, notificationVersion },
          })
        }
      })
      .catch((error) => {
        if (!isActive || !isCurrentSession(requestSessionGeneration)) return
        if (error?.status === 401) {
          signOut()
          return
        }
        dispatch({
          type: ACTIONS.NOTIFICATIONS_FAILED,
          payload: 'We could not load notifications. Please try again.',
        })
      })

    return () => {
      isActive = false
    }
  }, [authStatus, isCurrentSession, notificationRetry, sessionId, signOut])

  const retryHydration = useCallback(() => {
    if (
      authStatus === 'authenticated'
      && authSessionRef.current.authStatus === 'authenticated'
      && authSessionRef.current.sessionId === sessionId
    ) {
      setHydrationRetry((retry) => retry + 1)
    }
  }, [authStatus, sessionId])

  const retryNotifications = useCallback(() => {
    if (authSessionRef.current.authStatus === 'authenticated') {
      setNotificationRetry((retry) => retry + 1)
    }
  }, [])

  const applicationViews = useMemo(
    () => state.applications.map((application) => buildApplicationView(application, state.documents)),
    [state.applications, state.documents],
  )

  const documentViews = useMemo(
    () =>
      sortByCreatedAtDesc(
        state.documents.map((document) => buildDocumentView(document, state.applications)),
      ),
    [state.documents, state.applications],
  )

  const notificationViews = useMemo(
    () =>
      sortByCreatedAtDesc(
        state.notifications.map((notification) =>
          buildNotificationView(notification, state.applications, state.documents),
        ),
      ),
    [state.notifications, state.applications, state.documents],
  )

  const stats = useMemo(
    () => buildDashboardStats(applicationViews, notificationViews),
    [applicationViews, notificationViews],
  )

  const showToast = useCallback((message, tone = 'success') => {
    dispatch({ type: ACTIONS.TOAST_SHOWN, payload: { message, tone } })
  }, [])

  const dismissToast = useCallback(() => {
    dispatch({ type: ACTIONS.TOAST_HIDDEN })
  }, [])

  useEffect(() => {
    if (!state.toast) return undefined

    const timer = window.setTimeout(() => {
      dispatch({ type: ACTIONS.TOAST_HIDDEN })
    }, 4200)

    return () => window.clearTimeout(timer)
  }, [state.toast])

  const setRequirementStatus = useCallback(async (applicationId, requirementKey, status) => {
    const requestSessionGeneration = authSessionRef.current.generation
    const application = state.applications.find((entry) => entry.id === applicationId)
    if (!application) {
      throw new Error('Application not found.')
    }
    const requirement = (application.requirements ?? [])
      .find((entry) => entry.key === requirementKey)
    if (!requirement) {
      throw new Error('Checklist requirement not found.')
    }

    const completedAt = status === 'completed' ? new Date().toISOString() : null
    let result
    try {
      result = await saveRequirementStatus({
        applicationId,
        requirementKey,
        status,
        documentId: requirement.documentId ?? undefined,
      })
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : 'We could not update the checklist.'
      if (isCurrentSession(requestSessionGeneration)) {
        showToast(errorMessage, 'warning')
      }
      throw error
    }
    if (!isCurrentSession(requestSessionGeneration)) return

    const savedRequirement = result?.requirement
      ?? result?.application?.requirements?.find((entry) => entry.key === requirementKey)
    const patch = {
      status: savedRequirement?.status ?? status,
      documentId: Object.hasOwn(savedRequirement ?? {}, 'documentId')
        ? savedRequirement.documentId
        : requirement.documentId ?? null,
      completedAt: Object.hasOwn(savedRequirement ?? {}, 'completedAt')
        ? savedRequirement.completedAt
        : completedAt,
    }

    dispatch({
      type: ACTIONS.REQUIREMENT_UPDATED,
      payload: { applicationId, requirementKey, patch },
    })
    if (isNotification(result?.notification)) {
      dispatch({ type: ACTIONS.NOTIFICATION_UPSERTED, payload: result.notification })
    }
  }, [isCurrentSession, state.applications, showToast])

  const toggleRequirement = useCallback(
    (applicationId, requirementKey, currentStatus) => {
      const nextStatus = currentStatus === 'completed' ? 'missing' : 'completed'
      return setRequirementStatus(applicationId, requirementKey, nextStatus)
    },
    [setRequirementStatus],
  )

  const startApplication = useCallback(async (processId) => {
    try {
      const application = await createApplicationRecord({ processId })
      dispatch({ type: ACTIONS.APPLICATION_ADDED, payload: application })
      return application
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'We could not create the application.', 'warning')
      throw error
    }
  }, [showToast])

  const updateApplication = useCallback((id, patch) => {
    dispatch({ type: ACTIONS.APPLICATION_PATCHED, payload: { id, patch } })
  }, [])

  const openUploadModal = useCallback((prefill = null) => {
    dispatch({ type: ACTIONS.UPLOAD_OPENED, payload: prefill })
  }, [])

  const closeUploadModal = useCallback(() => {
    dispatch({ type: ACTIONS.UPLOAD_CLOSED })
  }, [])

  const submitUpload = useCallback(
    async (values) => {
      const requestSessionGeneration = authSessionRef.current.generation
      dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: true } })
      let document = null

      try {
        document = await uploadDocument({
          file: values.file,
          name: values.name,
          documentType: values.documentType,
          applicationId: values.applicationId,
          expiryDate: values.expiryDate,
          note: values.note,
        })
        if (!isCurrentSession(requestSessionGeneration)) return document

        dispatch({ type: ACTIONS.DOCUMENT_ADDED, payload: document })
        dispatch({ type: ACTIONS.UPLOAD_CLOSED })

        const application = state.applications.find((entry) => entry.id === document.applicationId)
        if (application) {
          const requirements = buildRequirements(application)
          const requirement = values.requirementKey
            ? requirements.find(
                (entry) =>
                  entry.key === values.requirementKey
                  && entry.type === document.documentType,
              ) ?? null
            : findRequirementByType(requirements, document.documentType)

          if (requirement) {
            const result = await saveRequirementStatus({
              applicationId: application.id,
              requirementKey: requirement.key,
              status: 'completed',
              documentId: document.id,
            })
            if (!isCurrentSession(requestSessionGeneration)) return document

            const savedRequirement = result?.requirement
              ?? result?.application?.requirements?.find((entry) => entry.key === requirement.key)

            dispatch({
              type: ACTIONS.REQUIREMENT_UPDATED,
              payload: {
                applicationId: application.id,
                requirementKey: requirement.key,
                patch: {
                  status: savedRequirement?.status ?? 'completed',
                  documentId: Object.hasOwn(savedRequirement ?? {}, 'documentId')
                    ? savedRequirement.documentId
                    : document.id,
                  completedAt: Object.hasOwn(savedRequirement ?? {}, 'completedAt')
                    ? savedRequirement.completedAt
                    : document.uploadedAt,
                },
              },
            })
            if (isNotification(result?.notification)) {
              dispatch({ type: ACTIONS.NOTIFICATION_UPSERTED, payload: result.notification })
            }
          }
        }

        showToast(`${document.name} added to your documents.`)
        return document
      } catch (error) {
        let errorMessage
        if (error?.status === 400) {
          errorMessage = 'Please check the document information and file, then try again.'
        } else if (error?.status === 401) {
          errorMessage = 'Your session has expired. Please sign in again and try again.'
        } else if (error?.status === 403) {
          errorMessage = 'You do not have permission to upload this document.'
        } else if (error?.status === 404) {
          errorMessage = 'The related resource could not be found. Please refresh and try again.'
        } else if (error?.status === 413) {
          errorMessage = 'The file is too large. Please choose a file no larger than 5 MiB.'
        } else if (error instanceof TypeError) {
          errorMessage = 'We could not reach the server. Check your connection and try again.'
        } else {
          errorMessage = 'Something went wrong while uploading the document. Please try again.'
        }
        const message = document
          ? `${document.name} was uploaded, but its checklist link could not be saved. ${errorMessage}`
          : errorMessage
        if (isCurrentSession(requestSessionGeneration)) {
          showToast(message, 'warning')
        }
        throw error
      } finally {
        if (isCurrentSession(requestSessionGeneration)) {
          dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: false } })
        }
      }
    },
    [isCurrentSession, state.applications, showToast],
  )

  const replaceDocument = useCallback(async (documentId, file) => {
    dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: true } })

    try {
      const updatedDocument = await replaceDocumentFile(documentId, file)
      if (updatedDocument?.id !== documentId) {
        throw new Error('The replacement response did not match the existing document.')
      }

      dispatch({
        type: ACTIONS.DOCUMENT_PATCHED,
        payload: { id: documentId, patch: updatedDocument },
      })
      showToast('Document file replaced successfully.')
      return updatedDocument
    } catch (error) {
      let message
      if (error?.status === 400) {
        message = 'Please check the selected file and try again.'
      } else if (error?.status === 401) {
        message = 'Your session has expired. Please sign in again.'
      } else if (error?.status === 403) {
        message = 'You do not have permission to replace this file.'
      } else if (error?.status === 404) {
        message = 'This document is no longer available.'
      } else if (error?.status === 413) {
        message = 'The selected file is too large. Maximum size is 5 MiB.'
      } else if (error instanceof TypeError) {
        message = 'Could not replace this file. Please check your connection and try again.'
      } else {
        message = 'Could not replace this file. Please try again.'
      }
      showToast(message, 'warning')
      throw error
    } finally {
      dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: false } })
    }
  }, [showToast])

  const updateDocument = useCallback(async (documentId, patch, message) => {
    try {
      const updatedDocument = await updateDocumentRecord(documentId, patch)
      dispatch({
        type: ACTIONS.DOCUMENT_PATCHED,
        payload: { id: documentId, patch: updatedDocument },
      })
      if (message) showToast(message)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'We could not update the document.', 'warning')
      throw error
    }
  }, [showToast])

  const removeDocument = useCallback(
    async (documentId) => {
      const document = state.documents.find((entry) => entry.id === documentId)
      try {
        await removeDocumentRecord(documentId)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'We could not delete the document.', 'warning')
        throw error
      }

      state.applications.forEach((application) => {
        (application.requirements ?? [])
          .filter((requirement) => requirement.documentId === documentId)
          .forEach((requirement) => {
            dispatch({
              type: ACTIONS.REQUIREMENT_UPDATED,
              payload: {
                applicationId: application.id,
                requirementKey: requirement.key,
                patch: { status: 'missing', documentId: null, completedAt: null },
              },
            })
          })
      })

      dispatch({ type: ACTIONS.DOCUMENT_REMOVED, payload: documentId })
      showToast(`${document?.name ?? 'Document'} removed.`, 'neutral')
    },
    [state.applications, state.documents, showToast],
  )

  const markNotificationRead = useCallback(async (notificationId) => {
    const requestSessionGeneration = authSessionRef.current.generation
    try {
      const notification = await readNotification(notificationId)
      if (!isCurrentSession(requestSessionGeneration)) return
      dispatch({ type: ACTIONS.NOTIFICATION_UPSERTED, payload: notification })
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return
      if (error?.status === 401) {
        signOut()
        return
      }
      showToast('We could not mark this notification as read. Please try again.', 'warning')
    }
  }, [isCurrentSession, showToast, signOut])

  const markAllNotificationsRead = useCallback(async () => {
    const requestSessionGeneration = authSessionRef.current.generation
    const notificationIds = state.notifications.map((notification) => notification.id)
    try {
      const updatedCount = await readAllNotifications()
      if (!isCurrentSession(requestSessionGeneration)) return
      dispatch({
        type: ACTIONS.NOTIFICATIONS_READ_ALL,
        payload: notificationIds,
      })
      setNotificationRetry((retry) => retry + 1)
      return updatedCount
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return
      if (error?.status === 401) {
        signOut()
        return
      }
      showToast('We could not mark all notifications as read. Please try again.', 'warning')
    }
  }, [isCurrentSession, showToast, signOut, state.notifications])

  const updateProfile = useCallback(
    async (values) => {
      try {
        const updatedUser = await saveProfile(values)
        const profile = normalizeProfile(updatedUser, state.profile)
        updateUser(updatedUser)
        dispatch({ type: ACTIONS.PROFILE_PATCHED, payload: profile })
        showToast('Your profile has been updated.')
        return profile
      } catch (error) {
        throw new Error(safeAccountError(error, 'profile'))
      }
    },
    [showToast, state.profile, updateUser],
  )

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }) => {
      try {
        const result = await savePassword({ currentPassword, newPassword })
        if (!storeAuthToken(result?.token)) {
          signOut()
          const error = new Error('Your password changed, but the new session could not be saved. Please sign in again.')
          error.code = 'TOKEN_STORAGE_FAILED'
          throw error
        }

        if (result?.user) updateUser(result.user)
        showToast('Your password has been changed.')
        return true
      } catch (error) {
        throw new Error(safeAccountError(error, 'password'))
      }
    },
    [showToast, signOut, updateUser],
  )

  const updatePreferences = useCallback(
    async (preferences) => {
      try {
        const updatedUser = await savePreferences(preferences)
        const profile = normalizeProfile(updatedUser, state.profile)
        updateUser(updatedUser)
        dispatch({
          type: ACTIONS.PROFILE_PATCHED,
          payload: { preferences: profile.preferences },
        })
        return profile.preferences
      } catch (error) {
        throw new Error(safeAccountError(error, 'preferences'))
      }
    },
    [state.profile, updateUser],
  )

  const openAssistant = useCallback(() => {
    dispatch({ type: ACTIONS.ASSISTANT_OPENED })
  }, [])

  const closeAssistant = useCallback(() => {
    dispatch({ type: ACTIONS.ASSISTANT_CLOSED })
  }, [])

  const askAssistant = useCallback(
    (question) => {
      const trimmed = String(question ?? '').trim()
      if (!trimmed) return

      dispatch({
        type: ACTIONS.ASSISTANT_STATE,
        payload: { isThinking: true },
      })

      dispatch({
        type: ACTIONS.ASSISTANT_MESSAGE,
        payload: {
          id: `user-${Date.now()}`,
          role: 'user',
          body: trimmed,
          createdAt: new Date().toISOString(),
        },
      })

      window.setTimeout(() => {
        const answer = findAssistantAnswer(trimmed)
        dispatch({ type: ACTIONS.ASSISTANT_STATE, payload: { isThinking: false } })
        dispatch({
          type: ACTIONS.ASSISTANT_MESSAGE,
          payload: {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            title: answer.title,
            body: answer.body,
            followUp: answer.followUp,
            createdAt: new Date().toISOString(),
          },
        })
      }, 620)
    },
    [],
  )

  const openDocumentPreview = useCallback((documentId) => {
    dispatch({ type: ACTIONS.PREVIEW_OPENED, payload: documentId })
  }, [])

  const closeDocumentPreview = useCallback(() => {
    dispatch({ type: ACTIONS.PREVIEW_CLOSED })
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      isLoading: state.status === 'loading',
      error: state.error,
      retryHydration,
      retryNotifications,
      applicationViews,
      documentViews,
      notificationViews,
      notificationsStatus: state.notificationsStatus,
      notificationsError: state.notificationsError,
      notificationsRefreshing: state.notificationsRefreshing,
      stats,
      getApplicationById: (id) =>
        applicationViews.find((application) => application.id === id) ?? null,
      getDocumentById: (id) => documentViews.find((document) => document.id === id) ?? null,
      recentApplications: sortByUpdatedAtDesc(applicationViews).slice(0, 4),
      recentDocuments: documentViews.slice(0, 5),
      setRequirementStatus,
      toggleRequirement,
      startApplication,
      updateApplication,
      openUploadModal,
      closeUploadModal,
      submitUpload,
      replaceDocument,
      updateDocument,
      removeDocument,
      markNotificationRead,
      markAllNotificationsRead,
      updateProfile,
      changePassword,
      updatePreferences,
      openAssistant,
      closeAssistant,
      askAssistant,
      openDocumentPreview,
      closeDocumentPreview,
      showToast,
      dismissToast,
    }),
    [
      state,
      retryHydration,
      applicationViews,
      documentViews,
      notificationViews,
      retryNotifications,
      stats,
      setRequirementStatus,
      toggleRequirement,
      startApplication,
      updateApplication,
      openUploadModal,
      closeUploadModal,
      submitUpload,
      replaceDocument,
      updateDocument,
      removeDocument,
      markNotificationRead,
      markAllNotificationsRead,
      updateProfile,
      changePassword,
      updatePreferences,
      openAssistant,
      closeAssistant,
      askAssistant,
      openDocumentPreview,
      closeDocumentPreview,
      showToast,
      dismissToast,
    ],
  )

  return (
    <AppDataContext.Provider value={value}>
      {children}
      <GlobalOverlays />
    </AppDataContext.Provider>
  )
}
