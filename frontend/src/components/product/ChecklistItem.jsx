import { CircleCheck, FileText, Hourglass, Paperclip, TriangleAlert } from 'lucide-react'
import { Button, Checkbox, Dropdown, StatusBadge } from '../ui'
import { formatDate } from '../../utils/format'
import { CHECKLIST_STATUS_LABELS } from '../../utils/checklist'
import { cn } from '../../utils/cn'

const STATUS_ICONS = {
  completed: CircleCheck,
  'in-progress': Hourglass,
  missing: TriangleAlert,
}

function StatusIcon({ status }) {
  const Icon = STATUS_ICONS[status] ?? TriangleAlert
  return <Icon size={15} aria-hidden="true" />
}

export function ChecklistItem({
  requirement,
  linkedDocument,
  onToggle,
  onSetStatus,
  onUpload,
  onReplaceDocument,
  onViewDocument,
  isUpdating = false,
}) {
  const isComplete = requirement.status === 'completed'
  const StatusIconComponent = STATUS_ICONS[requirement.status] ?? TriangleAlert

  return (
    <li className={cn('checklist-item', isComplete && 'checklist-item--done')}>
      <div className="checklist-item__control">
        <Checkbox
          checked={isComplete}
          disabled={isUpdating}
          onChange={() => onToggle?.(requirement)}
          aria-label={`Mark ${requirement.name} as ${isComplete ? 'not completed' : 'completed'}`}
        />
      </div>

      <div className="checklist-item__body">
        <div className="checklist-item__head">
          <h4 className="checklist-item__title">{requirement.name}</h4>
          <span
            className={cn('checklist-item__badge', `checklist-item__badge--${requirement.status}`)}
          >
            <StatusIcon status={requirement.status} />
            {CHECKLIST_STATUS_LABELS[requirement.status]}
          </span>
        </div>

        <p className="ui-caption checklist-item__description">{requirement.description}</p>

        {requirement.guidance ? (
          <p className="checklist-item__guidance">{requirement.guidance}</p>
        ) : null}

        <div className="checklist-item__meta">
          {requirement.isRequired ? (
            <StatusBadge status="neutral">Required</StatusBadge>
          ) : (
            <StatusBadge status="neutral">Optional</StatusBadge>
          )}

          {linkedDocument ? (
            <button
              type="button"
              className="checklist-item__link"
              onClick={() => onViewDocument?.(linkedDocument)}
            >
              <Paperclip size={13} aria-hidden="true" />
              {linkedDocument.name}
            </button>
          ) : null}

          {requirement.completedAt ? (
            <span className="ui-caption">Completed {formatDate(requirement.completedAt)}</span>
          ) : null}
        </div>
      </div>

      <div className="checklist-item__actions">
        {!isComplete ? (
          <Button
            variant="outline"
            size="sm"
            leadingIcon={<FileText size={14} aria-hidden="true" />}
            onClick={() => onUpload?.(requirement)}
          >
            Upload
          </Button>
        ) : null}

        <Dropdown
          label={`More actions for ${requirement.name}`}
          items={[
            {
              id: 'complete',
              label: 'Mark as completed',
              icon: <CircleCheck size={15} aria-hidden="true" />,
              isDisabled: isComplete,
              onSelect: () => onSetStatus?.(requirement, 'completed'),
            },
            {
              id: 'progress',
              label: 'Mark as in progress',
              icon: <StatusIconComponent size={15} aria-hidden="true" />,
              isDisabled: requirement.status === 'in-progress',
              onSelect: () => onSetStatus?.(requirement, 'in-progress'),
            },
            {
              id: 'missing',
              label: 'Mark as missing',
              icon: <TriangleAlert size={15} aria-hidden="true" />,
              isDisabled: requirement.status === 'missing',
              onSelect: () => onSetStatus?.(requirement, 'missing'),
            },
            { id: 'divider', type: 'divider' },
            {
              id: linkedDocument ? 'replace-document' : 'upload',
              label: linkedDocument ? 'Replace document' : 'Upload document',
              icon: <FileText size={15} aria-hidden="true" />,
              onSelect: () => {
                if (linkedDocument?.id) {
                  onReplaceDocument?.(linkedDocument)
                } else {
                  onUpload?.(requirement)
                }
              },
            },
          ]}
        />
      </div>
    </li>
  )
}
