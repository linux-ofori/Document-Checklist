import {
  Camera,
  Download,
  Eye,
  FileCheck2,
  FileText,
  IdCard,
  Pencil,
  RefreshCw,
  ScrollText,
  Trash2,
} from 'lucide-react'
import { Button, Dropdown, IconButton, StatusBadge } from '../ui'
import { formatCalendarDate, formatFileSize, formatRelativeTime } from '../../utils/format'
import { cn } from '../../utils/cn'

const TYPE_ICONS = {
  photograph: Camera,
  'identity-card': IdCard,
  'drivers-licence': IdCard,
  'test-results': ScrollText,
  transcript: ScrollText,
  'recommendation-letter': ScrollText,
  'application-form': FileCheck2,
  'birth-certificate': ScrollText,
  'tax-clearance': FileText,
}

function DocumentGlyph({ document }) {
  const Icon = TYPE_ICONS[document.documentType] ?? FileText
  return <Icon size={17} aria-hidden="true" />
}

export function DocumentRow({
  document,
  onView,
  onRename,
  onRefreshExpiry,
  onRemove,
  onDetachApplication,
}) {
  return (
    <tr className="document-row">
      <td className="document-row__name">
        <div className="document-row__lead">
          <span
            className={cn(
              'document-row__icon',
              document.isExpiring && 'document-row__icon--warning',
            )}
            aria-hidden="true"
          >
            <DocumentGlyph document={document} />
          </span>
          <span className="document-row__text">
            <span className="document-row__title">{document.name}</span>
            <span className="ui-caption">
              {document.fileName} · {formatFileSize(document.fileSizeKb)} · Added{' '}
              {formatRelativeTime(document.uploadedAt)}
            </span>
          </span>
        </div>
      </td>

      <td className="document-row__type">{document.typeLabel}</td>

      <td className="document-row__application">
        {document.applications?.length > 0 ? (
          <div className="document-row__association-list">
            {document.applications.map((application) => (
              <div className="document-row__association" key={application.id}>
                <span className="document-row__pill" title={application.name}>
                  {application.name}
                </span>
                {application.id ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Detach ${document.name} from ${application.name}`}
                    onClick={() => onDetachApplication?.(document, application)}
                  >
                    Detach
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : document.applicationName && document.applicationName !== 'Not linked' ? (
          <span className="document-row__pill">{document.applicationName}</span>
        ) : (
          <span className="ui-caption">Not linked</span>
        )}
      </td>

      <td className="document-row__status">
        <StatusBadge status={document.badgeStatus}>{document.statusLabel}</StatusBadge>
      </td>

      <td className="document-row__expiry">
        <span className={cn('ui-caption', document.isExpiring && 'document-row__expiry--soon')}>
          {formatCalendarDate(document.expiresAt, 'No expiry')}
        </span>
      </td>

      <td className="document-row__actions">
        <div className="document-row__action-group">
          <IconButton
            label={`View ${document.name}`}
            variant="subtle"
            onClick={() => onView?.(document)}
          >
            <Eye size={17} aria-hidden="true" />
          </IconButton>

          <Dropdown
            label={`More actions for ${document.name}`}
            items={[
              {
                id: 'view',
                label: 'View document',
                icon: <Eye size={15} aria-hidden="true" />,
                onSelect: () => onView?.(document),
              },
              {
                id: 'rename',
                label: 'Rename',
                icon: <Pencil size={15} aria-hidden="true" />,
                onSelect: () => onRename?.(document),
              },
              {
                id: 'expiry',
                label: document.expiresAt ? 'Update expiry date' : 'Add expiry date',
                icon: <RefreshCw size={15} aria-hidden="true" />,
                onSelect: () => onRefreshExpiry?.(document),
              },
              {
                id: 'download',
                label: 'Open copy',
                icon: <Download size={15} aria-hidden="true" />,
                onSelect: () => onView?.(document),
              },
              { id: 'divider', type: 'divider' },
              {
                id: 'delete',
                label: 'Delete document',
                icon: <Trash2 size={15} aria-hidden="true" />,
                isDestructive: true,
                onSelect: () => onRemove?.(document),
              },
            ]}
          />
        </div>
      </td>
    </tr>
  )
}

export function DocumentList({ documents, ...handlers }) {
  return (
    <div className="document-list">
      <table className="document-table">
        <thead>
          <tr>
            <th scope="col">Document</th>
            <th scope="col">Type</th>
            <th scope="col">Application</th>
            <th scope="col">Status</th>
            <th scope="col">Expiry</th>
            <th scope="col">
              <span className="ui-visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} {...handlers} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
