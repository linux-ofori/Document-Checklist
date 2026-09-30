import { FilePlus2, Sparkles, Upload } from 'lucide-react'
import { Button } from '../ui'
import { useAppData } from '../../hooks/useAppData'
import { useActiveRoute } from '../../hooks/useActiveRoute'
import { ROUTES } from '../../utils/routes'

export function QuickActions() {
  const { openUploadModal, openAssistant } = useAppData()
  const { navigate } = useActiveRoute()

  return (
    <div className="quick-actions">
      <Button
        variant="primary"
        size="md"
        leadingIcon={<FilePlus2 size={16} aria-hidden="true" />}
        onClick={() => navigate(ROUTES.chooseProcess)}
      >
        Start new application
      </Button>

      <Button
        variant="outline"
        size="md"
        leadingIcon={<Upload size={16} aria-hidden="true" />}
        onClick={() => openUploadModal()}
      >
        Upload document
      </Button>

      <Button
        variant="ghost"
        size="md"
        leadingIcon={<Sparkles size={16} aria-hidden="true" />}
        onClick={openAssistant}
      >
        Ask AI
      </Button>
    </div>
  )
}
