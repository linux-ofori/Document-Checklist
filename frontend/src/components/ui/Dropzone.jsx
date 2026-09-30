import { useRef, useState } from 'react'
import { FileUp, UploadCloud } from 'lucide-react'
import { cn } from '../../utils/cn'
import { Button } from './Button'

export function Dropzone({
  file,
  onFileSelect,
  onFileClear,
  onDragActiveChange,
  hint,
  formats = 'PDF, JPG or PNG',
  maxSizeMb = 5,
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
    const dropped = event.dataTransfer?.files?.[0]
    if (dropped) onFileSelect?.(dropped)
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
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" onClick={onFileClear}>
            Remove
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="ui-visually-hidden"
          accept={formats.replace(/ or /g, ',').replace(/ /g, '')}
          onChange={(event) => onFileSelect?.(event.target.files?.[0] ?? null)}
        />
      </div>
    )
  }

  return (
    <div
      className={cn('ui-dropzone', isDragging && 'ui-dropzone--active', className)}
      onDragOver={(event) => {
        event.preventDefault()
        setActive(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        if (event.currentTarget === event.target) setActive(false)
      }}
      onDrop={handleDrop}
    >
      <span className="ui-dropzone__icon" aria-hidden="true">
        <UploadCloud size={22} />
      </span>

      <div className="ui-dropzone__text">
        <p className="ui-dropzone__title">Drag and drop your file here</p>
        <p className="ui-caption">{hint ?? `${formats} up to ${maxSizeMb}MB`}</p>
      </div>

      <Button
        variant="outline"
        size="md"
        onClick={() => inputRef.current?.click()}
        leadingIcon={<FileUp size={16} aria-hidden="true" />}
      >
        Choose file
      </Button>

      <input
        ref={inputRef}
        type="file"
        className="ui-visually-hidden"
        accept={formats.replace(/ or /g, ',').replace(/ /g, '')}
        onChange={(event) => onFileSelect?.(event.target.files?.[0] ?? null)}
      />
    </div>
  )
}
