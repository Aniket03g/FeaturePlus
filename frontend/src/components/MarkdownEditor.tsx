import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Download, FileText, Image as ImageIcon, Paperclip, Plus, Trash2 } from 'lucide-react'
import { useDeleteFeatureAttachment, useUploadFeatureAttachment } from '@/lib/queries'
import { ApiError, fileUrl } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Markdown, attachmentMarkdown } from '@/components/Markdown'
import { fileSize, type FeatureAttachment } from '@/lib/types'
import { cn } from '@/lib/utils'

/** What to add after `before` so the next text starts a new paragraph. */
export function paragraphBreak(before: string) {
  if (before.trim() === '' || before.endsWith('\n\n')) return ''
  return before.endsWith('\n') ? '\n' : '\n\n'
}

/**
 * A markdown box with Write and Preview tabs, for a feature's description or
 * notes.
 *
 * Files can be attached with the button, or by pasting or dropping them into
 * the box. Each one is uploaded to the feature and a link to it goes in where
 * the cursor was: a picture for an image, a plain link for anything else.
 */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  featureId,
  attachments,
  height,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  featureId: number
  attachments: FeatureAttachment[]
  /** Any CSS height; the box and the preview both take it. */
  height: string
  placeholder?: string
}) {
  const upload = useUploadFeatureAttachment(featureId)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [uploading, setUploading] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  /**
   * Puts text in at the cursor as a paragraph of its own, and leaves the
   * cursor after it. A blank line is needed, not just a new one: a line
   * straight after a table row or list item is read as part of it.
   */
  function insert(text: string) {
    const el = area.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const before = value.slice(0, start)
    const after = value.slice(end)
    const lead = paragraphBreak(before)
    const trail = after.startsWith('\n') ? '' : '\n'
    const next = before + lead + text + trail + after
    onChange(next)
    const caret = (before + lead + text + trail).length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  async function send(files: File[]) {
    if (files.length === 0) return
    setError('')
    setTab('write')
    const links: string[] = []
    // One at a time, so a failure names the file it happened on.
    for (const file of files) {
      setUploading(file.name)
      try {
        links.push(attachmentMarkdown(await upload.mutateAsync(file)))
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `${file.name}: ${err.fields.file ?? err.message}`
            : `${file.name} could not be uploaded`,
        )
        break
      }
    }
    setUploading('')
    if (links.length) insert(links.join('\n'))
    if (picker.current) picker.current.value = ''
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    void send(files)
  }

  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    e.preventDefault()
    void send(files)
  }

  const tabClass = (on: boolean) =>
    cn(
      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
      on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
    )

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        <div className="ml-auto flex items-center gap-1 rounded-md bg-raised p-0.5" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'write'} className={tabClass(tab === 'write')} onClick={() => setTab('write')}>
            Write
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} className={tabClass(tab === 'preview')} onClick={() => setTab('preview')}>
            Preview
          </button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => picker.current?.click()}
          loading={upload.isPending}
          title="Attach a file, or paste or drop one into the box"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach file
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void send(Array.from(e.target.files ?? []))}
        />
      </div>

      {tab === 'write' ? (
        <textarea
          id={id}
          ref={area}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDragging(true)
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          placeholder={placeholder}
          style={{ height }}
          className={cn(
            'w-full resize-y rounded-md border bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50',
            dragging ? 'border-accent ring-2 ring-accent/50' : 'border-border',
          )}
        />
      ) : (
        <div style={{ height }} className="overflow-y-auto rounded-md border border-border bg-surface px-4 py-3">
          {value.trim() ? (
            <Markdown text={value} attachments={attachments} />
          ) : (
            <p className="text-sm text-faint">Nothing to preview.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-2xs text-faint">
        {uploading ? (
          <span>Uploading {uploading}…</span>
        ) : error ? (
          <span role="alert" className="text-danger">{error}</span>
        ) : (
          <span>
            Markdown: **bold**, # heading, - list, [link](https://…). Paste or drop a picture to add it.
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The files attached to a feature, each with a way to put its link in the
 * text being edited, download it, or remove it.
 */
export function FeatureFiles({
  featureId,
  attachments,
  onInsert,
  canEdit,
}: {
  featureId: number
  attachments: FeatureAttachment[]
  /** Given while editing: puts the file's link into the description. */
  onInsert?: (markdown: string) => void
  canEdit: boolean
}) {
  const remove = useDeleteFeatureAttachment(featureId)
  const [confirming, setConfirming] = useState(0)

  if (attachments.length === 0) return null

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">
        Files <span className="font-normal normal-case tracking-normal">({attachments.length})</span>
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {attachments.map((file) => {
          const isImage = file.mime_type.startsWith('image/')
          const Icon = isImage ? ImageIcon : FileText
          return (
            <li key={file.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Icon className="h-3.5 w-3.5 shrink-0 text-faint" />
              <span className="min-w-0 truncate font-mono text-ink">{file.name}</span>
              <span className="shrink-0 text-faint">{fileSize(file.file_size)}</span>
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {confirming === file.id ? (
                  <>
                    <span className="mr-1 text-danger">Remove? Links to it will show as missing.</span>
                    <Button variant="secondary" size="sm" className="h-6 px-2" onClick={() => setConfirming(0)}>
                      Keep
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 bg-danger px-2 hover:bg-danger/90"
                      loading={remove.isPending}
                      onClick={async () => {
                        await remove.mutateAsync(file.id)
                        setConfirming(0)
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    {onInsert && (
                      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => onInsert(attachmentMarkdown(file))}>
                        <Plus className="h-3 w-3" />
                        Insert
                      </Button>
                    )}
                    <a
                      href={fileUrl(`/feature-attachments/${file.id}/content`)}
                      className="inline-flex h-6 items-center rounded px-2 text-muted hover:bg-raised hover:text-ink"
                      aria-label={`Download ${file.name}`}
                    >
                      <Download className="h-3 w-3" />
                    </a>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-danger hover:bg-danger-soft hover:text-danger"
                        onClick={() => setConfirming(file.id)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
