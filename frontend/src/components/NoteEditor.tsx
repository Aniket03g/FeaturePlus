import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * A note that can be edited in place: the text with a small pencil after it,
 * which turns it into a box. Enter or the tick saves, Escape or the cross
 * cancels. Without onSave it only shows the note.
 */
export function NoteEditor({
  note,
  empty = 'No note',
  onSave,
  className,
  strong = false,
  title,
}: {
  note: string
  /** What shows when there is no note. */
  empty?: string
  onSave?: (note: string) => Promise<unknown>
  className?: string
  /** Bold text, for published versions. */
  strong?: boolean
  title?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function start() {
    setDraft(note)
    setError('')
    setEditing(true)
  }

  async function save() {
    if (!onSave) return
    if (draft.trim() === note.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the note')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1', className)}>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setEditing(false)
            }}
            placeholder="What this version is, or what is being worked on"
            aria-label="Note"
            className="h-7 min-w-0 flex-1 rounded-md border border-accent bg-surface px-2 text-xs text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            aria-label="Save the note"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-success hover:bg-raised"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Cancel"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && <p className="text-2xs text-danger">{error}</p>}
      </div>
    )
  }

  return (
    <div className={cn('group/note flex min-w-0 items-center gap-1.5', className)} title={title}>
      {note ? (
        <span className={cn('line-clamp-2 min-w-0', strong ? 'font-semibold text-ink' : 'text-ink')}>{note}</span>
      ) : (
        <span className="font-normal text-faint">{empty}</span>
      )}
      {onSave && (
        <button
          type="button"
          onClick={start}
          aria-label={note ? 'Edit the note' : 'Add a note'}
          title={note ? 'Edit the note' : 'Add a note'}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-raised hover:text-accent"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
