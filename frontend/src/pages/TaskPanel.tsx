import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useTask,
  useUpdateTask,
} from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Comment } from '@/lib/types'

/**
 * A task, shown in a side panel rather than its own page.
 *
 * A task is read in the context of its feature — you look at one, then the
 * next — so taking over the whole screen and forcing a trip back each time
 * would be the wrong shape. The panel slides over, and the list stays put.
 */
export function TaskPanel({
  taskId,
  featureId,
  projectId,
  onClose,
}: {
  taskId: number
  featureId: number
  projectId: number
  onClose: () => void
}) {
  const task = useTask(taskId)
  const comments = useComments(taskId)
  const update = useUpdateTask(featureId, projectId)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (task.data) {
      setName(task.data.task_name)
      setDescription(task.data.description)
    }
  }, [task.data])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function save() {
    setError('')
    try {
      await update.mutateAsync({ id: taskId, task_name: name, description })
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes')
    }
  }

  const data = task.data

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
        className="flex h-full w-full max-w-lg animate-fade-in flex-col border-l border-border bg-surface shadow-pop"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {data?.done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-faint" />
            )}
            <span className="truncate text-sm font-semibold text-ink">
              {data?.task_name ?? 'Task'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {task.isLoading || !data ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            </div>
          ) : (
            <div className="space-y-5 p-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
                >
                  {error}
                </div>
              )}

              {editing ? (
                <div className="space-y-3">
                  <Input
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                  <div className="space-y-1.5">
                    <label htmlFor="task-description" className="block text-xs font-medium text-muted">
                      Description
                    </label>
                    <textarea
                      id="task-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" loading={update.isPending} onClick={save}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge>{data.task_type}</Badge>
                    <Badge tone={data.done ? 'success' : 'neutral'}>
                      {data.done ? 'Complete' : 'Outstanding'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </Button>
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-muted">
                    {data.description || 'No description.'}
                  </p>
                </div>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
                  Pull requests
                </h3>
                {data.pull_requests.length === 0 ? (
                  <p className="text-xs text-faint">
                    None yet. A task becomes complete once one is tested and approved.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.pull_requests.map((pr) => (
                      <li key={pr.id}>
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs transition-colors hover:border-accent/40 hover:bg-raised"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0 text-faint" />
                          <span className="min-w-0 flex-1 truncate text-ink">{pr.title}</span>
                          {pr.tested && <Badge tone="accent">tested</Badge>}
                          <Badge tone={pr.approved ? 'success' : 'neutral'}>{pr.status}</Badge>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
                  Comments
                </h3>
                <CommentThread
                  taskId={taskId}
                  featureId={featureId}
                  comments={comments.data?.items ?? []}
                  loading={comments.isLoading}
                />
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function CommentThread({
  taskId,
  featureId,
  comments,
  loading,
}: {
  taskId: number
  featureId: number
  comments: Comment[]
  loading: boolean
}) {
  const { user } = useAuth()
  const add = useAddComment(taskId, featureId)
  const remove = useDeleteComment(taskId)

  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return

    setError('')
    try {
      await add.mutateAsync(text)
      setText('')
      inputRef.current?.focus()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post that comment')
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-xs text-faint">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-faint">No comments yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {comments.map((comment) => {
            const mine = comment.author?.id === user?.id
            return (
              <li key={comment.id} className="group rounded-md bg-raised px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-ink">
                    {comment.author?.username ?? 'Someone'}
                  </span>
                  <span className="text-2xs text-faint">{formatWhen(comment.created_at)}</span>
                  {mine && (
                    <button
                      onClick={() => remove.mutate(comment.id)}
                      aria-label="Delete comment"
                      className="ml-auto text-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-xs text-muted">{comment.content}</p>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — the convention
            // everywhere else a short message is typed.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit(e as unknown as FormEvent)
            }
          }}
          rows={2}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className={cn(
            'w-full resize-y rounded-md border bg-surface px-3 py-2 text-xs text-ink',
            'placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50',
            error ? 'border-danger' : 'border-border',
          )}
        />
        {error && <p className="text-2xs text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>
            <Send className="h-3 w-3" />
            Comment
          </Button>
        </div>
      </form>
    </div>
  )
}

/** A short relative time, falling back to a date once it stops being useful. */
function formatWhen(iso: string) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`

  return new Date(iso).toLocaleDateString()
}
