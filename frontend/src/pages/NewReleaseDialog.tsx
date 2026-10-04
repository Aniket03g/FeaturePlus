import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useCreateRelease, useFeatures } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { STATUS_LABEL } from '@/lib/types'

/**
 * The plan-a-release dialog.
 *
 * Features can be picked here rather than only afterwards, because a release
 * with nothing in it cannot be published and a person who has just decided to
 * cut one already knows roughly what is going into it.
 *
 * It follows the same keyboard contract as the other dialogs: Escape closes,
 * focus moves in on open and returns to the trigger on close, and a click on
 * the backdrop dismisses.
 */
export function NewReleaseDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: number
  onClose: () => void
  onCreated: (releaseId: number) => void
}) {
  const create = useCreateRelease(projectId)
  const features = useFeatures(projectId, {})

  const [tag, setTag] = useState('')
  const [notes, setNotes] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const tagRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    tagRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      ;(previouslyFocused.current as HTMLElement | null)?.focus?.()
    }
  }, [onClose])

  // A feature already in another release would be moved by assigning it here,
  // so those are offered separately rather than mixed in unmarked.
  const available = features.data?.items ?? []

  function togglePicked(id: number) {
    setPicked((current) =>
      current.includes(id) ? current.filter((f) => f !== id) : [...current, id],
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setFormError('')

    try {
      const release = await create.mutateAsync({
        tag: tag.trim(),
        notes,
        feature_ids: picked.length > 0 ? picked : undefined,
      })
      onCreated(release.id)
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
        aria-labelledby="new-release-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="new-release-title" className="text-sm font-semibold text-ink">
            Plan a release
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

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {formError && (
              <div
                role="alert"
                className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
              >
                {formError}
              </div>
            )}

            <Input
              ref={tagRef}
              label="Tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              error={fieldErrors.tag}
              placeholder="v1.2.0"
              hint="Unique within this project"
              className="font-mono"
              required
            />

            <div className="space-y-1.5">
              <label htmlFor="release-notes" className="block text-xs font-medium text-muted">
                Notes
              </label>
              <textarea
                id="release-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What is in this release?"
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted">
                Features
                {picked.length > 0 && (
                  <span className="ml-1.5 font-normal text-faint">{picked.length} picked</span>
                )}
              </span>

              {features.isLoading ? (
                <p className="text-xs text-faint">Loading features…</p>
              ) : available.length === 0 ? (
                <p className="text-xs text-faint">
                  This project has no features yet. You can add them to the release later.
                </p>
              ) : (
                <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                  {available.map((feature) => (
                    <button
                      key={feature.id}
                      type="button"
                      onClick={() => togglePicked(feature.id)}
                      aria-pressed={picked.includes(feature.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                        picked.includes(feature.id)
                          ? 'bg-accent-soft text-accent'
                          : 'text-muted hover:bg-raised hover:text-ink',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{feature.title}</span>
                      <span className="shrink-0 text-2xs text-faint">
                        {STATUS_LABEL[feature.status] ?? feature.status}
                      </span>
                      {feature.release_id !== null && (
                        <span className="shrink-0 text-2xs text-warning" title="Currently in another release">
                          moves
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {fieldErrors.feature_ids && (
                <p className="text-xs text-danger">{fieldErrors.feature_ids}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border p-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create release
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
