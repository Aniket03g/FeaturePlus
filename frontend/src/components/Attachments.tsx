import { useRef, useState } from 'react'
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { useAttachments, useDeleteAttachment, useUploadAttachment } from '@/lib/queries'
import { ApiError, fileUrl } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { fileSize, type Attachment } from '@/lib/types'

/**
 * Files attached to a task.
 *
 * The bytes go into the database rather than onto disk, which is what keeps a
 * project to one file you can copy — and is why there is a size limit the
 * server enforces and this reports.
 */
export function Attachments({ taskId }: { taskId: number }) {
  const attachments = useAttachments(taskId)
  const upload = useUploadAttachment(taskId)
  const remove = useDeleteAttachment(taskId)

  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  async function send(files: FileList | null) {
    if (!files || files.length === 0) return
    setError('')

    // One at a time, so a failure halfway names the file it happened on.
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync(file)
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `${file.name}: ${err.fields.file ?? err.message}`
            : `${file.name} could not be uploaded`,
        )
        break
      }
    }

    if (input.current) input.current.value = ''
  }

  const items = attachments.data?.items ?? []

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">Attachments</h3>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7"
          onClick={() => input.current?.click()}
          loading={upload.isPending}
        >
          <Upload className="h-3 w-3" />
          Add
        </Button>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => send(e.target.files)}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          send(e.dataTransfer.files)
        }}
        className={
          dragging
            ? 'rounded-md border border-dashed border-accent bg-accent-soft/40 p-3'
            : 'rounded-md border border-dashed border-transparent p-0'
        }
      >
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {error}
          </p>
        )}

        {attachments.isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-faint">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs text-faint">
            None yet. Drop a file here, or use Add.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                onDelete={() => remove.mutate(attachment.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Types the server will serve inline, so a preview is worth offering. */
const PREVIEWABLE = /^image\//

function AttachmentRow({
  attachment,
  onDelete,
}: {
  attachment: Attachment
  onDelete: () => void
}) {
  const [preview, setPreview] = useState(false)
  const canPreview = PREVIEWABLE.test(attachment.mime_type)

  const href = fileUrl(`/attachments/${attachment.id}/content`)
  const inlineHref = fileUrl(`/attachments/${attachment.id}/content`, { disposition: 'inline' })

  // The stored name carries a uniqueness prefix; show the part a person typed.
  const name = attachment.file_name.includes('|')
    ? attachment.file_name.slice(attachment.file_name.indexOf('|') + 1)
    : attachment.file_name

  return (
    <li className="rounded-md border border-border">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <Paperclip className="h-3 w-3 shrink-0 text-faint" />
        <button
          onClick={() => canPreview && setPreview((v) => !v)}
          disabled={!canPreview}
          className="min-w-0 flex-1 truncate text-left text-xs text-ink enabled:hover:underline"
          title={canPreview ? 'Show a preview' : name}
        >
          {name}
        </button>
        <span className="shrink-0 text-2xs text-faint">{fileSize(attachment.file_size)}</span>
        <a
          href={href}
          className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
          aria-label={`Download ${name}`}
        >
          <Download className="h-3 w-3" />
        </a>
        <button
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-raised hover:text-danger"
          aria-label={`Delete ${name}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {preview && canPreview && (
        <div className="border-t border-border p-2">
          <img src={inlineHref} alt={name} className="max-h-64 rounded" />
        </div>
      )}
    </li>
  )
}
