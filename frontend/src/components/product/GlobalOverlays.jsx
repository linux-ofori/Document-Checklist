import { UploadDocumentModal } from './UploadDocumentModal'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { AskAiPanel } from './AskAiPanel'
import { Toast } from './Toast'
import { useActiveRoute } from '../../hooks/useActiveRoute'
import { useAuth } from '../../context/AuthProvider'
import { matchRoute } from '../../utils/routes'

const AUTHENTICATED_APP_ROUTES = new Set([
  'dashboard',
  'applications',
  'chooseProcess',
  'application',
  'documents',
  'reminders',
  'profile',
  'settings',
])

export function GlobalOverlays() {
  const { path } = useActiveRoute()
  const { status } = useAuth()
  const isAuthenticatedAppRoute = AUTHENTICATED_APP_ROUTES.has(matchRoute(path).name)

  return (
    <>
      <UploadDocumentModal />
      <DocumentPreviewModal />
      <Toast />
      {status === 'authenticated' && isAuthenticatedAppRoute ? <AskAiPanel /> : null}
    </>
  )
}
