import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useAuth } from './AuthProvider'
import {
  fetchApplications,
  fetchDocuments,
  fetchNotifications,
  fetchProcesses,
  isNotification,
  addDocumentApplication,
  readAllNotifications,
  readNotification,
  removeDocumentApplication,
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

function getConfirmedRequirement(result, applicationId, requirementKey, status, documentId) {
  const application = result?.application
  if (application?.id !== applicationId) return null

  const matchingRequirements = Array.isArray(application.requirements)
    ? application.requirements.filter((entry) => entry.key === requirementKey)
    : []
  if (matchingRequirements.length > 1) return null

  let requirement
  if (result?.requirement !== undefined) {
    if (result.requirement?.key !== requirementKey) return null
    requirement = result.requirement
    if (
      matchingRequirements.length === 1
      && (
        matchingRequirements[0].status !== status
        || matchingRequirements[0].documentId !== documentId
      )
    ) {
      return null
    }
  } else {
    requirement = matchingRequirements[0]
  }

  if (
    !requirement
    || requirement.status !== status
    || !Object.hasOwn(requirement, 'documentId')
    || requirement.documentId !== documentId
  ) {
    return null
  }

  return requirement
}

export function AppDataProvider({ children }) {
  const [state, dispatch] = useReducer(appDataReducer, INITIAL_STATE)
  const [hydrationRetry, setHydrationRetry] = useState(0)
  const [notificationRetry, setNotificationRetry] = useState(0)
  const { status: authStatus, user, updateUser, signOut } = useAuth()
  const hydrationRef = useRef({
    sessionId: null,
    generation: null,
    promise: null,
    status: 'idle',
  })
  const userRef = useRef(user)
  const sessionId = user?.id ?? user?.email ?? null
  const [authSession, setAuthSession] = useState(() => ({
    authStatus,
    sessionId,
    generation: 0,
  }))
  const sessionChanged = authSession.authStatus !== authStatus
    || authSession.sessionId !== sessionId
  const sessionGeneration = authSession.generation + (sessionChanged ? 1 : 0)
  if (sessionChanged) {
    setAuthSession({ authStatus, sessionId, generation: sessionGeneration })
  }
  const authSessionRef = useRef(authSession)
  const notificationVersionRef = useRef(state.notificationVersion)

  useLayoutEffect(() => {
    authSessionRef.current = authSession
  }, [authSession])

  useLayoutEffect(() => {
    userRef.current = user
  }, [user])

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
      const sessionGeneration = authSessionRef.current.generation
      hydrationRef.current = {
        sessionId: null,
        generation: sessionGeneration,
        promise: null,
        status: 'idle',
      }
      setHydrationRetry(0)
      dispatch({
        type: ACTIONS.AUTH_RESET,
        payload: { sessionId: null, sessionGeneration },
      })
      return undefined
    }

    if (authStatus !== 'authenticated') return undefined

    const sessionGeneration = authSessionRef.current.generation
    if (
      hydrationRef.current.sessionId !== sessionId
      || hydrationRef.current.generation !== sessionGeneration
    ) {
      hydrationRef.current = {
        sessionId,
        generation: sessionGeneration,
        promise: null,
        status: 'idle',
      }
      dispatch({
        type: ACTIONS.AUTH_RESET,
        payload: { sessionId, sessionGeneration },
      })
    } else if (hydrationRef.current.status === 'succeeded') return undefined

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
          profile: normalizeProfile(userRef.current),
        }))
        .then((payload) => {
          if (
            hydrationRef.current.sessionId === sessionId
            && hydrationRef.current.generation === sessionGeneration
            && hydrationRef.current.promise === hydrationPromise
          ) {
            hydrationRef.current.status = 'succeeded'
          }
          return payload
        })
        .catch((error) => {
          if (
            hydrationRef.current.sessionId === sessionId
            && hydrationRef.current.generation === sessionGeneration
            && hydrationRef.current.promise === hydrationPromise
          ) {
            hydrationRef.current.promise = null
            hydrationRef.current.status = 'idle'
          }
          throw error
        })
      hydrationRef.current.promise = hydrationPromise
      hydrationRef.current.status = 'pending'
    }

    let isActive = true
    hydrationRef.current.promise
      .then((payload) => {
        if (!isActive || !isCurrentSession(sessionGeneration)) return
        dispatch({
          type: ACTIONS.HYDRATE,
          payload: { ...payload, sessionId, sessionGeneration },
        })
      })
      .catch((error) => {
        if (!isActive || !isCurrentSession(sessionGeneration)) return
        dispatch({
          type: ACTIONS.HYDRATE_FAILED,
          payload: error instanceof Error ? error.message : 'We could not load your account data.',
          sessionId,
          sessionGeneration,
        })
      })

    return () => {
      isActive = false
    }
  }, [authStatus, hydrationRetry, isCurrentSession, sessionId])

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

  const sessionState = authStatus === 'authenticated'
    && state.sessionId === sessionId
    && state.sessionGeneration === sessionGeneration
    ? state
    : INITIAL_STATE

  const applicationViews = useMemo(
    () => sessionState.applications.map(
      (application) => buildApplicationView(application, sessionState.documents),
    ),
    [sessionState.applications, sessionState.documents],
  )

  const documentViews = useMemo(
    () =>
      sortByCreatedAtDesc(
        sessionState.documents.map(
          (document) => buildDocumentView(document, sessionState.applications),
        ),
      ),
    [sessionState.documents, sessionState.applications],
  )

  const notificationViews = useMemo(
    () =>
      sortByCreatedAtDesc(
        sessionState.notifications.map((notification) =>
          buildNotificationView(notification, sessionState.applications, sessionState.documents),
        ),
      ),
    [sessionState.notifications, sessionState.applications, sessionState.documents],
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

  const setRequirementStatus = useCallback(async (
    applicationId,
    requirementKey,
    status,
    documentIdOverride,
    {
      suppressErrorToast = false,
      expectedSessionGeneration,
      requireConfirmedResponse = false,
    } = {},
  ) => {
    const requestSessionGeneration = expectedSessionGeneration
      ?? authSessionRef.current.generation
    if (!isCurrentSession(requestSessionGeneration)) return false
    const application = state.applications.find((entry) => entry.id === applicationId)
    if (!application) {
      throw new Error('Application not found.')
    }
    const requirement = (application.requirements ?? [])
      .find((entry) => entry.key === requirementKey)
      ?? buildRequirements(application).find((entry) => entry.key === requirementKey)
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
        documentId: documentIdOverride !== undefined
          ? documentIdOverride
          : requirement.documentId ?? undefined,
      })
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return false
      const errorMessage = error instanceof Error
        ? error.message
        : 'We could not update the checklist.'
      if (!suppressErrorToast) {
        showToast(errorMessage, 'warning')
      }
      throw error
    }
    if (!isCurrentSession(requestSessionGeneration)) return false

    const confirmedRequirement = requireConfirmedResponse
      ? getConfirmedRequirement(result, applicationId, requirementKey, status, documentIdOverride)
      : null
    if (requireConfirmedResponse && !confirmedRequirement) {
      const error = new Error('The server did not confirm this document link. Please retry the checklist link.')
      if (!suppressErrorToast) showToast(error.message, 'warning')
      throw error
    }

    const savedRequirement = requireConfirmedResponse
      ? confirmedRequirement
      : result?.requirement
        ?? result?.application?.requirements?.find((entry) => entry.key === requirementKey)
    const patch = {
      status: requireConfirmedResponse ? savedRequirement.status : savedRequirement?.status ?? status,
      documentId: requireConfirmedResponse
        ? savedRequirement.documentId
        : Object.hasOwn(savedRequirement ?? {}, 'documentId')
        ? savedRequirement.documentId
        : documentIdOverride ?? requirement.documentId ?? null,
      completedAt: requireConfirmedResponse
        ? savedRequirement.completedAt ?? completedAt
        : Object.hasOwn(savedRequirement ?? {}, 'completedAt')
        ? savedRequirement.completedAt
        : completedAt,
    }

    dispatch({
      type: ACTIONS.REQUIREMENT_UPDATED,
      payload: {
        applicationId,
        requirementKey,
        patch,
        requirement,
      },
    })
    if (isNotification(result?.notification)) {
      dispatch({ type: ACTIONS.NOTIFICATION_UPSERTED, payload: result.notification })
    }
    return true
  }, [isCurrentSession, state.applications, showToast])

  const toggleRequirement = useCallback(
    (applicationId, requirementKey, currentStatus) => {
      const nextStatus = currentStatus === 'completed' ? 'missing' : 'completed'
      return setRequirementStatus(applicationId, requirementKey, nextStatus)
    },
    [setRequirementStatus],
  )

  const startApplication = useCallback(async (processId) => {
    const requestSessionGeneration = authSessionRef.current.generation
    if (!isCurrentSession(requestSessionGeneration)) return null

    try {
      const application = await createApplicationRecord({ processId })
      if (!isCurrentSession(requestSessionGeneration)) return null
      dispatch({ type: ACTIONS.APPLICATION_ADDED, payload: application })
      return application
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return null
      showToast(error instanceof Error ? error.message : 'We could not create the application.', 'warning')
      throw error
    }
  }, [isCurrentSession, showToast])

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
    const requestSessionGeneration = authSessionRef.current.generation
    if (!isCurrentSession(requestSessionGeneration)) return null

    dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: true } })

    try {
      const updatedDocument = await replaceDocumentFile(documentId, file)
      if (!isCurrentSession(requestSessionGeneration)) return null
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
      if (!isCurrentSession(requestSessionGeneration)) return null
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
      if (isCurrentSession(requestSessionGeneration)) {
        dispatch({ type: ACTIONS.UPLOAD_STATE, payload: { isSubmitting: false } })
      }
    }
  }, [isCurrentSession, showToast])

  const updateDocument = useCallback(async (documentId, patch, message) => {
    const requestSessionGeneration = authSessionRef.current.generation
    if (!isCurrentSession(requestSessionGeneration)) return null

    try {
      const updatedDocument = await updateDocumentRecord(documentId, patch)
      if (!isCurrentSession(requestSessionGeneration)) return null
      dispatch({
        type: ACTIONS.DOCUMENT_PATCHED,
        payload: { id: documentId, patch: updatedDocument },
      })
      if (message) showToast(message)
      return true
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return null
      showToast(error instanceof Error ? error.message : 'We could not update the document.', 'warning')
      throw error
    }
  }, [isCurrentSession, showToast])

  const associateDocumentWithApplication = useCallback(async (
    documentId,
    applicationId,
    {
      suppressSuccessToast = false,
      suppressErrorToast = false,
      expectedSessionGeneration,
    } = {},
  ) => {
    const requestSessionGeneration = expectedSessionGeneration
      ?? authSessionRef.current.generation
    if (!isCurrentSession(requestSessionGeneration)) return false
    try {
      const updatedDocument = await addDocumentApplication(documentId, applicationId)
      if (!isCurrentSession(requestSessionGeneration)) return false
      dispatch({
        type: ACTIONS.DOCUMENT_PATCHED,
        payload: { id: documentId, patch: updatedDocument },
      })
      if (!suppressSuccessToast) showToast('Document linked to application.')
      return true
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return false
      if (!suppressErrorToast) {
        showToast('We could not link this document to the application. Please try again.', 'warning')
      }
      throw error
    }
  }, [isCurrentSession, showToast])

  const associateDocumentAndLinkRequirement = useCallback(async (
    documentId,
    applicationId,
    requirementKey,
  ) => {
    const requestSessionGeneration = authSessionRef.current.generation
    const associated = await associateDocumentWithApplication(
      documentId,
      applicationId,
      {
        suppressSuccessToast: true,
        suppressErrorToast: true,
        expectedSessionGeneration: requestSessionGeneration,
      },
    )
    if (!associated || !isCurrentSession(requestSessionGeneration)) return false

    try {
      const linked = await setRequirementStatus(
        applicationId,
        requirementKey,
        'completed',
        documentId,
        {
          suppressErrorToast: true,
          expectedSessionGeneration: requestSessionGeneration,
          requireConfirmedResponse: true,
        },
      )
      if (!linked || !isCurrentSession(requestSessionGeneration)) return false
      return { associationSucceeded: true, linked: true }
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return false
      return { associationSucceeded: true, linked: false, error }
    }
  }, [associateDocumentWithApplication, isCurrentSession, setRequirementStatus])

  const detachDocumentFromApplication = useCallback(async (documentId, applicationId) => {
    const requestSessionGeneration = authSessionRef.current.generation
    try {
      const updatedDocument = await removeDocumentApplication(documentId, applicationId)
      if (!isCurrentSession(requestSessionGeneration)) return
      dispatch({
        type: ACTIONS.DOCUMENT_PATCHED,
        payload: { id: documentId, patch: updatedDocument },
      })
      showToast('Document detached from application.', 'neutral')
    } catch (error) {
      if (!isCurrentSession(requestSessionGeneration)) return
      const message = error?.status === 409
        ? 'Unlink this document from the checklist item first, then retry detaching it.'
        : 'We could not detach this document from the application. Please try again.'
      showToast(message, 'warning')
      throw error
    }
  }, [isCurrentSession, showToast])

  const removeDocument = useCallback(
    async (documentId) => {
      const requestSessionGeneration = authSessionRef.current.generation
      if (!isCurrentSession(requestSessionGeneration)) return false

      const document = state.documents.find((entry) => entry.id === documentId)
      try {
        await removeDocumentRecord(documentId)
        if (!isCurrentSession(requestSessionGeneration)) return false
      } catch (error) {
        if (!isCurrentSession(requestSessionGeneration)) return false
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
      return true
    },
    [isCurrentSession, state.applications, state.documents, showToast],
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
      const requestSessionGeneration = authSessionRef.current.generation
      if (!isCurrentSession(requestSessionGeneration)) return null

      try {
        const updatedUser = await saveProfile(values)
        if (!isCurrentSession(requestSessionGeneration)) return null
        const profile = normalizeProfile(updatedUser, state.profile)
        updateUser(updatedUser)
        dispatch({ type: ACTIONS.PROFILE_PATCHED, payload: profile })
        showToast('Your profile has been updated.')
        return profile
      } catch (error) {
        if (!isCurrentSession(requestSessionGeneration)) return null
        throw new Error(safeAccountError(error, 'profile'))
      }
    },
    [isCurrentSession, showToast, state.profile, updateUser],
  )

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }) => {
      const requestSessionGeneration = authSessionRef.current.generation
      if (!isCurrentSession(requestSessionGeneration)) return false

      try {
        const result = await savePassword({ currentPassword, newPassword })
        if (!isCurrentSession(requestSessionGeneration)) return false
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
        if (!isCurrentSession(requestSessionGeneration) && error?.code !== 'TOKEN_STORAGE_FAILED') {
          return false
        }
        throw new Error(safeAccountError(error, 'password'))
      }
    },
    [isCurrentSession, showToast, signOut, updateUser],
  )

  const updatePreferences = useCallback(
    async (preferences) => {
      const requestSessionGeneration = authSessionRef.current.generation
      if (!isCurrentSession(requestSessionGeneration)) return null

      try {
        const updatedUser = await savePreferences(preferences)
        if (!isCurrentSession(requestSessionGeneration)) return null
        const profile = normalizeProfile(updatedUser, state.profile)
        updateUser(updatedUser)
        dispatch({
          type: ACTIONS.PROFILE_PATCHED,
          payload: { preferences: profile.preferences },
        })
        return profile.preferences
      } catch (error) {
        if (!isCurrentSession(requestSessionGeneration)) return null
        throw new Error(safeAccountError(error, 'preferences'))
      }
    },
    [isCurrentSession, state.profile, updateUser],
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
      ...sessionState,
      isLoading: sessionState.status === 'loading',
      error: sessionState.error,
      retryHydration,
      retryNotifications,
      applicationViews,
      documentViews,
      notificationViews,
      notificationsStatus: sessionState.notificationsStatus,
      notificationsError: sessionState.notificationsError,
      notificationsRefreshing: sessionState.notificationsRefreshing,
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
      associateDocumentWithApplication,
      associateDocumentAndLinkRequirement,
      detachDocumentFromApplication,
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
      sessionState,
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
      associateDocumentWithApplication,
      associateDocumentAndLinkRequirement,
      detachDocumentFromApplication,
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
