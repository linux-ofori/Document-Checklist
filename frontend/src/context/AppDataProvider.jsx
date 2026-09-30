import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  fetchApplications,
  fetchDocuments,
  fetchNotifications,
  fetchProcesses,
  fetchProfile,
  readAllNotifications,
  readNotification,
  removeDocumentRecord,
  savePassword,
  savePreferences,
  saveProfile,
  updateDocumentRecord,
  uploadDocument,
  createApplicationRecord,
  saveRequirementStatus,
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

export function AppDataProvider({ children }) {
  const [state, dispatch] = useReducer(appDataReducer, INITIAL_STATE)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true

    const hydrate = async () => {
      const [processes, applications, documents, notifications, profile] = await Promise.all([
        fetchProcesses(),
        fetchApplications(),
        fetchDocuments(),
        fetchNotifications(),
        fetchProfile(),
      ])

      if (!isMountedRef.current) return

      dispatch({ type: ACTIONS.HYDRATE, payload: { processes, applications, documents, notifications, profile } })
    }

    hydrate()

    return () => {
      isMountedRef.current = false
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
    const completedAt = status === 'completed' ? new Date().toISOString() : null

    dispatch({
      type: ACTIONS.REQUIREMENT_UPDATED,
      payload: { applicationId, requirementKey, patch: { status, completedAt } },
    })

    await saveRequirementStatus({ applicationId, requirementKey, status, completedAt })
  }, [])

  const toggleRequirement = useCallback(
    (applicationId, requirementKey, currentStatus) => {
      const nextStatus = currentStatus === 'completed' ? 'missing' : 'completed'
      return setRequirementStatus(applicationId, requirementKey, nextStatus)
    },
    [setRequirementStatus],
  )

  const startApplication = useCallback(async (processId) => {
    const application = await createApplicationRecord({ processId })
    dispatch({ type: ACTIONS.APPLICATION_ADDED, payload: application })
    return application
  }, [])

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
      dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: true } })

      const document = await uploadDocument({
        name: values.name,
        documentType: values.documentType,
        applicationId: values.applicationId,
        fileName: values.fileName,
        fileSizeKb: values.fileSizeKb,
        expiryDate: values.expiryDate,
        note: values.note,
      })

      dispatch({ type: ACTIONS.DOCUMENT_ADDED, payload: document })

      const application = state.applications.find((entry) => entry.id === document.applicationId)
      if (application) {
        const requirement = findRequirementByType(
          buildRequirements(application),
          document.documentType,
        )

        if (requirement) {
          dispatch({
            type: ACTIONS.REQUIREMENT_UPDATED,
            payload: {
              applicationId: application.id,
              requirementKey: requirement.key,
              patch: {
                status: 'completed',
                documentId: document.id,
                completedAt: document.uploadedAt,
              },
            },
          })
        }
      }

      dispatch({ type: ACTIONS.UPLOAD_CLOSED })
      showToast(`${document.name} added to your documents.`)

      return document
    },
    [state.applications, showToast],
  )

  const updateDocument = useCallback(async (documentId, patch, message) => {
    dispatch({ type: ACTIONS.DOCUMENT_PATCHED, payload: { id: documentId, patch } })
    await updateDocumentRecord(documentId, patch)
    if (message) showToast(message)
  }, [showToast])

  const removeDocument = useCallback(
    async (documentId) => {
      const document = state.documents.find((entry) => entry.id === documentId)

      state.applications.forEach((application) => {
        const affected = (application.requirements ?? []).filter(
          (requirement) => requirement.documentId === documentId,
        )

        affected.forEach((requirement) => {
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
      await removeDocumentRecord(documentId)
      showToast(`${document?.name ?? 'Document'} removed.`, 'neutral')
    },
    [state.applications, state.documents, showToast],
  )

  const markNotificationRead = useCallback(async (notificationId) => {
    dispatch({ type: ACTIONS.NOTIFICATION_READ, payload: notificationId })
    await readNotification(notificationId)
  }, [])

  const markAllNotificationsRead = useCallback(async () => {
    dispatch({ type: ACTIONS.NOTIFICATIONS_READ_ALL })
    await readAllNotifications()
  }, [])

  const updateProfile = useCallback(
    async (values) => {
      await saveProfile(values)
      dispatch({ type: ACTIONS.PROFILE_PATCHED, payload: values })
      showToast('Your profile has been updated.')
      return true
    },
    [showToast],
  )

  const changePassword = useCallback(
    async () => {
      await savePassword()
      showToast('Your password has been changed.')
      return true
    },
    [showToast],
  )

  const updatePreferences = useCallback(
    async (preferences) => {
      dispatch({ type: ACTIONS.PROFILE_PATCHED, payload: { preferences } })
      await savePreferences(preferences)
    },
    [],
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
      applicationViews,
      documentViews,
      notificationViews,
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
      applicationViews,
      documentViews,
      notificationViews,
      stats,
      setRequirementStatus,
      toggleRequirement,
      startApplication,
      updateApplication,
      openUploadModal,
      closeUploadModal,
      submitUpload,
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
