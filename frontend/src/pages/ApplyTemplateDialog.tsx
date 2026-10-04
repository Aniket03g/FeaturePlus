import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { useApplyTemplate, useTemplates } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TemplateDetail } from './Templates'
import { cn, plural } from '@/lib/utils'
import type { ApplyTemplateResult } from '@/lib/types'

/**
 * Apply a template to a project.
 *
 * Applying adds; it never replaces. That is worth saying on the screen, because
 * "apply a template" reads like it might overwrite what is already there, and
 * a person who believes that will not press the button.
 */
export function ApplyTemplateDialog({
  projectId,
  onClose,
}: {
  projectId: number
  onClose: () => void
}) {
  const templates = useTemplates()
  const apply = useApplyTemplate(projectId)

  const [picked, setPicked] = useState('')
  const [result, setResult] = useState<ApplyTemplateResult | null>(null)
  const [error, setError] = useState('')

  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement

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

  async function submit() {
    setError('')
    try {
      setResult(await apply.mutateAsync(picked))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  const items = templates.data?.items ?? []

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
        aria-labelledby="apply-template-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="apply-template-title" className="text-sm font-semibold text-ink">
            Apply a template
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {result ? (
            <div className="space-y-2 rounded-md border border-success/40 bg-success-soft/40 p-4">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" />
                <p className="text-sm font-medium text-ink">{result.template_name} applied</p>
              </div>
              <p className="text-xs text-muted">
                {plural(result.features_created, 'feature')} and{' '}
                {plural(result.tasks_created, 'task')} added to this project.
                {result.features_skipped > 0 &&
                  ` ${plural(result.features_skipped, 'feature')} could not be created.`}
              </p>
              {result.skipped_because && (
                <p className="text-xs text-warning">{result.skipped_because}</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2.5 rounded-md border border-border bg-raised/40 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                <p className="text-xs text-muted">
                  A template <span className="font-medium text-ink">adds</span> its features and
                  tasks to this project. Nothing already here is changed or removed, and the
                  project's categories and task types are taken from the template.
                </p>
              </div>

              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}

              {templates.isLoading ? (
                <p className="text-xs text-faint">Loading templates…</p>
              ) : items.length === 0 ? (
                <p className="text-xs text-muted">
                  No templates are installed. The catalogue lives in data/templates.json beside the
                  application.
                </p>
              ) : (
                <div className="space-y-1">
                  {items.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setPicked(picked === template.id ? '' : template.id)}
                      aria-pressed={picked === template.id}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                        picked === template.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-border hover:bg-raised',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{template.name}</span>
                        <span className="text-2xs text-faint">
                          {plural(template.feature_count, 'feature')} ·{' '}
                          {plural(template.task_count, 'task')}
                        </span>
                      </div>
                      {template.tech_stack && <Badge>{template.tech_stack}</Badge>}
                    </button>
                  ))}
                </div>
              )}

              {picked && <TemplateDetail id={picked} />}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button size="sm" onClick={submit} loading={apply.isPending} disabled={!picked}>
              Apply template
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
