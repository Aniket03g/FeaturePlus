import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useCreateFeature } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type FeaturePriority,
  type FeatureStatus,
} from '@/lib/types'

/**
 * The new-feature dialog.
 *
 * It handles its own keyboard contract rather than relying on a library:
 * Escape closes, focus moves in on open and returns to the trigger on close,
 * and a click on the backdrop dismisses. Without those a modal is a trap for
 * anyone not using a mouse.
 */
export function NewFeatureDialog({
  projectId,
  onClose,
  parentFeatureId,
  parentTitle,
}: {
  projectId: number
  onClose: () => void
  /** Create the feature inside another one, rather than at the top level. */
  parentFeatureId?: number
  parentTitle?: string
}) {
  const create = useCreateFeature(projectId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<FeatureStatus>('todo')
  const [priority, setPriority] = useState<FeaturePriority>('medium')
  const [tagText, setTagText] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    titleRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // The page behind a modal must not scroll with it.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      // Return focus where it came from, so the keyboard does not land at the
      // top of the document.
      ;(previouslyFocused.current as HTMLElement | null)?.focus?.()
    }
  }, [onClose])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setFormError('')

    const tags = tagText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      await create.mutateAsync({
        title,
        description,
        status,
        priority,
        tags,
        ...(parentFeatureId ? { parent_feature_id: parentFeatureId } : {}),
      })
      onClose()
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields)
        if (Object.keys(error.fields).length === 0) setFormError(error.message)
      } else {
        setFormError('Could not reach the server')
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-feature-title"
        className="w-full max-w-md animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="new-feature-title" className="text-sm font-semibold text-ink">
            {parentTitle ? `New feature in ${parentTitle}` : 'New feature'}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4" noValidate>
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {formError}
            </div>
          )}

          <Input
            ref={titleRef}
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={fieldErrors.title}
            placeholder="What should this feature do?"
            required
          />

          <div className="space-y-1.5">
            <label htmlFor="feature-description" className="block text-xs font-medium text-muted">
              Description
            </label>
            <textarea
              id="feature-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional detail"
              className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Choice
              label="Status"
              value={status}
              options={Object.entries(STATUS_LABEL) as [FeatureStatus, string][]}
              onChange={setStatus}
            />
            <Choice
              label="Priority"
              value={priority}
              options={Object.entries(PRIORITY_LABEL) as [FeaturePriority, string][]}
              onChange={setPriority}
            />
          </div>

          <Input
            label="Tags"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="ui, backend"
            hint="Separate with commas"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create feature
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** A small segmented control, used for the two enum fields. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <div className="flex rounded-md border border-border p-0.5" role="group" aria-label={label}>
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={cn(
              'flex-1 rounded px-1.5 py-1 text-2xs transition-colors',
              value === key
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-muted hover:bg-raised hover:text-ink',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
