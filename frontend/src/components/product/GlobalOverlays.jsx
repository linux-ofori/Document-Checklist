import { UploadDocumentModal } from './UploadDocumentModal'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { AskAiPanel } from './AskAiPanel'
import { Toast } from './Toast'
import { useActiveRoute } from '../../hooks/useActiveRoute'
import { ROUTES } from '../../utils/routes'

const MARKETING_ROUTES = [ROUTES.landing, ROUTES.login, ROUTES.signup]

export function GlobalOverlays() {
  const { path } = useActiveRoute()
  const isMarketing = MARKETING_ROUTES.includes(path)

  return (
    <>
      <UploadDocumentModal />
      <DocumentPreviewModal />
      <Toast />
      {isMarketing ? null : <AskAiPanel />}
    </>
  )
}
