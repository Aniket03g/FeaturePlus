import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import {
  useDeleteMessage,
  useFeatureMessages,
  usePostMessage,
  useUpdateMessage,
  type FeatureMessage,
} from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Where Project › Messages asks the feature page to land: on this message,
 * in the thread. Kept in the session and used once, so a reload or the back
 * button does not jump again.
 */
const JUMP_KEY = 'featureplus:jump-to-message'

export function jumpToMessage(messageId: number) {
  try {
    sessionStorage.setItem(JUMP_KEY, String(messageId))
  } catch {
    // Without storage the feature page simply opens at the top.
  }
}

function takeJump(): number | null {
  try {
    const id = Number(sessionStorage.getItem(JUMP_KEY))
    sessionStorage.removeItem(JUMP_KEY)
    return id > 0 ? id : null
  } catch {
    return null
  }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const box =
  'w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40'

/**
 * The messages left on a feature, oldest first, with a box to add one.
 * Anyone on the project may write; you edit or remove only your own.
 */
export function FeatureMessages({ projectId, featureId }: { projectId: number; featureId: number }) {
  const messages = useFeatureMessages(featureId)
  // A message to land on, asked for by Project › Messages; highlighted a moment.
  const [jumpTo] = useState(takeJump)
  const [highlight, setHighlight] = useState<number | null>(jumpTo)
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!jumpTo || !messages.data) return
    const row = document.getElementById(`message-${jumpTo}`)
    ;(row ?? anchor.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const done = window.setTimeout(() => setHighlight(null), 2500)
    return () => window.clearTimeout(done)
  }, [jumpTo, messages.data])
  const post = usePostMessage(projectId, featureId)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setError('')
    try {
      await post.mutateAsync(text.trim())
      setText('')
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.fields)[0] || err.message : 'Could not reach the server')
    }
  }

  const list = messages.data ?? []

  return (
    <div ref={anchor} id="messages">
      <Card>
        <CardHeader className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-faint" />
          <CardTitle>Messages</CardTitle>
          {list.length > 0 && <span className="text-xs text-faint">{list.length}</span>}
        </CardHeader>
        <CardBody className="space-y-3">
          {messages.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : list.length === 0 ? (
            <p className="text-sm text-faint">No messages yet. Ask a question or leave a note for the team.</p>
          ) : (
            <ul className="space-y-3">
              {list.map((m) => (
                <MessageRow
                  key={m.id}
                  featureId={featureId}
                  projectId={projectId}
                  message={m}
                  highlighted={highlight === m.id}
                />
              ))}
            </ul>
          )}

          <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(e as unknown as FormEvent)
              }}
              rows={2}
              maxLength={5000}
              placeholder="Write a message…"
              aria-label="New message"
              className={box}
            />
            <div className="flex items-center justify-between gap-2">
              {error ? (
                <p className="text-xs text-danger">{error}</p>
              ) : (
                <span className="text-2xs text-faint">Ctrl+Enter sends</span>
              )}
              <Button type="submit" size="sm" loading={post.isPending} disabled={!text.trim()}>
                Send
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}

function MessageRow({
  projectId,
  featureId,
  message,
  highlighted,
}: {
  projectId: number
  featureId: number
  message: FeatureMessage
  /** Just landed on from Project › Messages. */
  highlighted: boolean
}) {
  const update = useUpdateMessage(projectId, featureId)
  const remove = useDeleteMessage(projectId, featureId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [confirming, setConfirming] = useState(false)

  return (
    <li
      id={`message-${message.id}`}
      className={cn(
        'group/msg -mx-2 rounded-md px-2 py-1 transition-colors duration-700',
        highlighted && 'bg-accent-soft/60',
      )}
    >
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-ink">{message.author.name || 'Someone since removed'}</span>
        <span className="text-faint">
          {when(message.created_at)}
          {message.edited && ' · edited'}
        </span>
        {message.mine && !editing && (
          <span className="ml-auto flex gap-1 opacity-0 transition group-hover/msg:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => {
                setDraft(message.content)
                setEditing(true)
              }}
              aria-label="Edit your message"
              className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-accent"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label="Delete your message"
              className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-danger"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={5000}
            className={box}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={update.isPending}
              disabled={!draft.trim()}
              onClick={() =>
                update.mutate({ id: message.id, content: draft.trim() }, { onSuccess: () => setEditing(false) })
              }
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{message.content}</p>
      )}
      {confirming && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-danger">Delete this message?</span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button
            size="sm"
            className="h-7 bg-danger hover:bg-danger/90"
            loading={remove.isPending}
            onClick={() => remove.mutate(message.id)}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  )
}
