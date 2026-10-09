import { useMemo, useRef, useState } from 'react'
import { FolderOpen, Plus, Search, TriangleAlert, Upload } from 'lucide-react'
import { AppLayout } from '../layouts/AppLayout'
import { DocumentList, StatCard } from '../components/product'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  SearchInput,
  Select,
} from '../components/ui'
import { useAppData } from '../hooks/useAppData'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { DOCUMENT_TYPE_OPTIONS } from '../data'
import { searchDocuments } from '../utils/checklist'
import { pluralize, toDateInputValue } from '../utils/format'

const EXPIRY_FILTERS = [
  { value: 'all', label: 'All documents' },
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'none', label: 'No expiry date' },
]

export function DocumentsPage() {
  const {
    documentViews,
    applicationViews,
    openUploadModal,
    openDocumentPreview,
    updateDocument,
    detachDocumentFromApplication,
    removeDocument,
  } = useAppData()

  const [query, setQuery] = useState('')
  const [expiry, setExpiry] = useState('all')
  const [type, setType] = useState('all')
  const [isRemoveOpen, setIsRemoveOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingDetach, setPendingDetach] = useState(null)
  const [isDetaching, setIsDetaching] = useState(false)
  const detachInFlightRef = useRef(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [pendingRename, setPendingRename] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [isExpiring, setIsExpiring] = useState(false)
  const [pendingExpiry, setPendingExpiry] = useState(null)
  const [expiryValue, setExpiryValue] = useState('')

  const debouncedQuery = useDebouncedValue(query, 200)

  const counts = useMemo(
    () => ({
      total: documentViews.length,
      expiring: documentViews.filter((document) => document.isExpiring).length,
      expiringSoon: documentViews.filter((document) => document.expiryState === 'expiring').length,
      expired: documentViews.filter((document) => document.isExpired).length,
    }),
    [documentViews],
  )

  const visibleDocuments = useMemo(() => {
    const matched = searchDocuments(documentViews, debouncedQuery, applicationViews)

    return matched.filter((document) => {
      if (type !== 'all' && document.documentType !== type) return false
      if (expiry === 'all') return true
      if (expiry === 'none') return document.expiryState === 'none'
      return document.expiryState === expiry
    })
  }, [documentViews, applicationViews, debouncedQuery, type, expiry])

  const openRename = (document) => {
    setPendingRename(document)
    setRenameValue(document.name)
    setIsRenaming(true)
  }

  const submitRename = async () => {
    const name = renameValue.trim()
    if (!name || !pendingRename) return

    await updateDocument(pendingRename.id, { name }, `Renamed to ${name}.`)
    setIsRenaming(false)
    setPendingRename(null)
  }

  const openExpiry = (document) => {
    setPendingExpiry(document)
    setExpiryValue(document.expiresAt ? toDateInputValue(document.expiresAt) : '')
    setIsExpiring(true)
  }

  const submitExpiry = async () => {
    if (!pendingExpiry) return

    const expiresAt = expiryValue ? new Date(expiryValue).toISOString() : null
    await updateDocument(
      pendingExpiry.id,
      { expiresAt },
      expiryValue ? 'Expiry date updated. Reminders rescheduled.' : 'Expiry date removed.',
    )
    setIsExpiring(false)
    setPendingExpiry(null)
  }

  const confirmRemove = async () => {
    if (!pendingDelete) return
    await removeDocument(pendingDelete.id)
    setIsRemoveOpen(false)
    setPendingDelete(null)
  }

  const confirmDetach = async () => {
    const { document, application } = pendingDetach ?? {}
    if (!document?.id || !application?.id || detachInFlightRef.current) return

    detachInFlightRef.current = true
    setIsDetaching(true)
    try {
      await detachDocumentFromApplication(document.id, application.id)
      setPendingDetach(null)
    } catch {
      // The provider reports the API error; keep the confirmation open to allow retry.
    } finally {
      detachInFlightRef.current = false
      setIsDetaching(false)
    }
  }

  return (
    <AppLayout
      actions={
        <Button
          variant="primary"
          size="md"
          leadingIcon={<Upload size={16} aria-hidden="true" />}
          onClick={() => openUploadModal()}
        >
          Upload document
        </Button>
      }
    >
      <div className="app-page">
        <header className="page-section__title">
          <h1 className="ui-page-title">My documents</h1>
          <p className="ui-body">
            One library for every file you have uploaded. Each document can be linked to as many
            applications as it applies to.
          </p>
        </header>

        <div className="stat-grid">
          <StatCard
            label="Documents in library"
            value={counts.total}
            icon={<FolderOpen size={18} />}
            tone="primary"
          />
          <StatCard
            label="Expiring soon"
            value={counts.expiringSoon}
            hint="Within the next 45 days"
            icon={<TriangleAlert size={18} />}
            tone="warning"
            onClick={() => setExpiry('expiring')}
          />
          <StatCard
            label="Expired"
            value={counts.expired}
            hint="Needs replacing before use"
            icon={<TriangleAlert size={18} />}
            tone="danger"
            onClick={() => setExpiry('expired')}
          />
        </div>

        {counts.expired > 0 ? (
          <Alert
            tone="danger"
            icon={<TriangleAlert size={18} aria-hidden="true" />}
            title={`${pluralize(counts.expired, 'document')} already expired`}
            description="Upload a replacement and we will relink it to every application that relied on the old file."
          />
        ) : null}

        <div className="toolbar">
          <div className="toolbar__search">
            <SearchInput
              label="Search documents"
              placeholder="Search names, types or applications"
              value={query}
              onValueChange={setQuery}
            />
          </div>

          <div className="toolbar__filters">
            <Select
              label="Document type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              options={[{ value: 'all', label: 'All types' }, ...DOCUMENT_TYPE_OPTIONS]}
              wrapperClassName="toolbar__field"
            />
            <Select
              label="Expiry"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              options={EXPIRY_FILTERS}
              wrapperClassName="toolbar__field"
            />
          </div>

          <span className="ui-caption toolbar__count">
            {pluralize(visibleDocuments.length, 'document')}
          </span>
        </div>

        {visibleDocuments.length === 0 ? (
          <Card padding="spacious">
            <EmptyState
              icon={query || type !== 'all' || expiry !== 'all' ? (
                <Search size={22} aria-hidden="true" />
              ) : (
                <FolderOpen size={22} aria-hidden="true" />
              )}
              title={
                query || type !== 'all' || expiry !== 'all'
                  ? 'No documents match your filters'
                  : 'Your library is empty'
              }
              description={
                query || type !== 'all' || expiry !== 'all'
                  ? 'Try another search term, or reset the type and expiry filters.'
                  : 'Upload a document once and reuse it on every application you are working on.'
              }
              action={
                query || type !== 'all' || expiry !== 'all' ? (
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => {
                      setQuery('')
                      setType('all')
                      setExpiry('all')
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    leadingIcon={<Plus size={16} aria-hidden="true" />}
                    onClick={() => openUploadModal()}
                  >
                    Upload document
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <Card padding="flush">
            <DocumentList
              documents={visibleDocuments}
              onView={(document) => openDocumentPreview(document.id)}
              onRename={openRename}
              onRefreshExpiry={openExpiry}
              onDetachApplication={(document, application) => {
                if (!document?.id || !application?.id || detachInFlightRef.current) return
                setPendingDetach({ document, application })
              }}
              onRemove={(document) => {
                setPendingDelete(document)
                setIsRemoveOpen(true)
              }}
            />
          </Card>
        )}

        <p className="ui-caption">
          Documents are matched to checklist items automatically when you upload them, so one file
          can complete several requirements at once.
        </p>
      </div>

      <Modal
        isOpen={isRenaming}
        onClose={() => setIsRenaming(false)}
        title="Rename document"
        description="Use a name you will recognise later, especially if you upload a replacement."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setIsRenaming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={submitRename}
              disabled={!renameValue.trim()}
            >
              Save name
            </Button>
          </>
        }
      >
        <Input
          label="Document name"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          placeholder="Ghana Card 2026"
          data-autofocus
        />
      </Modal>

      <Modal
        isOpen={isExpiring}
        onClose={() => setIsExpiring(false)}
        title="Update expiry date"
        description="We use this to warn you 60, 30 and 7 days before the document runs out."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setIsExpiring(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" onClick={submitExpiry}>
              Save expiry date
            </Button>
          </>
        }
      >
        <Input
          label="Expiry date"
          type="date"
          value={expiryValue}
          onChange={(event) => setExpiryValue(event.target.value)}
          hint="Clear this if the document never expires."
          data-autofocus
        />
      </Modal>

      <Modal
        isOpen={Boolean(pendingDetach)}
        onClose={() => {
          if (!isDetaching) setPendingDetach(null)
        }}
        title="Detach document from application?"
        description={
          pendingDetach
            ? `${pendingDetach.document.name} will no longer be associated with ${pendingDetach.application.name}. The document will stay in your library and remain associated with any other applications.`
            : undefined
        }
        size="sm"
        closeOnEscape={!isDetaching}
        closeOnOverlayClick={!isDetaching}
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setPendingDetach(null)}
              disabled={isDetaching}
            >
              Keep association
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={confirmDetach}
              isLoading={isDetaching}
              disabled={!pendingDetach?.document?.id || !pendingDetach?.application?.id}
            >
              Detach from application
            </Button>
          </>
        }
      >
        <p className="ui-body">
          If a checklist requirement in this application still references the document, unlink
          that checklist item first. Detaching does not delete the document.
        </p>
      </Modal>

      <Modal
        isOpen={isRemoveOpen}
        onClose={() => setIsRemoveOpen(false)}
        title="Delete this document?"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be removed from your library and every checklist item it satisfied will go back to missing.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setIsRemoveOpen(false)}>
              Keep document
            </Button>
            <Button variant="danger" size="md" onClick={confirmRemove}>
              Delete document
            </Button>
          </>
        }
      >
        <p className="ui-body">
          This cannot be undone. If you only need to replace it, upload the new file instead.
        </p>
      </Modal>
    </AppLayout>
  )
}
