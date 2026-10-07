import { useRef, useState } from 'react'
import { FileUp, UploadCloud } from 'lucide-react'
import { cn } from '../../utils/cn'
import { Button } from './Button'

export function Dropzone({
  file,
  onFileSelect,
  onFileClear,
  onFileError,
  onDragActiveChange,
  hint,
  formats = 'PDF, JPG, JPEG, PNG',
  accept = '.pdf,.jpg,.jpeg,.png',
  maxSizeMiB = 5,
  disabled = false,
  className,
}) {
  const inputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const setActive = (value) => {
    setIsDragging(value)
    onDragActiveChange?.(value)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setActive(false)
    if (disabled) return

    const droppedFiles = event.dataTransfer?.files
    if (!droppedFiles?.length) return
    if (droppedFiles.length > 1) {
      onFileError?.('Only one file can be uploaded at a time. Choose a single file.')
      return
    }

    onFileSelect?.(droppedFiles[0])
  }

  const handleInputChange = (event) => {
    const selected = event.target.files?.[0] ?? null
    event.target.value = ''
    if (selected) onFileSelect?.(selected)
  }

  if (file) {
    return (
      <div className={cn('ui-dropzone', 'ui-dropzone--filled', className)}>
        <span className="ui-dropzone__icon" aria-hidden="true">
          <FileUp size={20} />
        </span>

        <div className="ui-dropzone__text">
          <p className="ui-dropzone__title">{file.name}</p>
          <p className="ui-caption">{file.meta}</p>
        </div>

        <div className="ui-dropzone__actions">
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" onClick={onFileClear} disabled={disabled}>
            Remove
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="ui-visually-hidden"
          accept={accept}
          onChange={handleInputChange}
          disabled={disabled}
        />
      </div>
    )
  }

  return (
    <div
      className={cn('ui-dropzone', isDragging && 'ui-dropzone--active', className)}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setActive(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        if (!disabled && event.currentTarget === event.target) setActive(false)
      }}
      onDrop={handleDrop}
    >
      <span className="ui-dropzone__icon" aria-hidden="true">
        <UploadCloud size={22} />
      </span>

      <div className="ui-dropzone__text">
        <p className="ui-dropzone__title">Drag and drop your file here</p>
        <p className="ui-caption">{hint ?? `${formats} up to ${maxSizeMiB} MiB`}</p>
      </div>

      <Button
        variant="outline"
        size="md"
        onClick={() => inputRef.current?.click()}
        leadingIcon={<FileUp size={16} aria-hidden="true" />}
        disabled={disabled}
      >
        Choose file
      </Button>

      <input
        ref={inputRef}
        type="file"
        className="ui-visually-hidden"
        accept={accept}
        onChange={handleInputChange}
        disabled={disabled}
      />
    </div>
  )
}
