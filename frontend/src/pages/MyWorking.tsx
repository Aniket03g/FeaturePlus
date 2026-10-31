import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AlertCircle,
  Check,
  Download,
  GripVertical,
  GitBranch,
  Info,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  useCopy,
  useDeleteCopy,
  useFeatureAttachments,
  useMyCopies,
  useProjects,
  usePublished,
  useSaveCopyList,
  useStartCopy,
  type MyCopy,
} from '@/lib/queries'
import {
  addRow,
  branchHeight,
  branchRange,
  deleteBranch,
  depths,
  moveBranch,
  newKey,
  rowsForSave,
  rowsFromSnapshot,
  updateRow,
  type CopyRow,
} from '@/lib/copy-tree'
import { gapTarget, intoTarget, MAX_DEPTH, type DropRow, type DropTarget } from '@/lib/tree-drop'
import { downloadCopyFile } from '@/lib/feature-file'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Dialog } from '@/components/Dialog'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, PriorityPill } from '@/components/FeatureBits'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { Markdown } from '@/components/Markdown'
import { cn, plural } from '@/lib/utils'
import { PRIORITY_LABEL, STATUS_LABEL, type FeaturePriority, type FeatureStatus } from '@/lib/types'

/**
 * My Space: your own copies of projects' feature lists, made and edited here
 * in the page. Feature List › Working opens the copy you edited last; My
 * Versions lists them all. A copy starts from a project's published list or
 * its working list; only you see it, and nothing in it changes the project.
 * Bringing a copy back into its project (merging) is parked for now.
 */

/** Said on both screens, so nobody expects their edits to reach the project. */
function ParkedNote() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-raised px-3 py-2 text-xs text-muted">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Only you can see your copies, and editing them never changes the project. Bringing a copy's changes back into
        its project (merging) is parked for now.
      </span>
    </div>
  )
}

function copyTitle(copy: { name: string; number: number }) {
  return copy.name || `Copy ${copy.number}`
}

/** Where a copy came from, in words. */
function copySource(copy: MyCopy | { source: string; base: MyCopy['base']; created_at: string }) {
  if (copy.source === 'published') return `from Published #${copy.base.publish_number}`
  if (copy.source === 'working') {
    const when = new Date(copy.created_at).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })
    return `from Working, ${when}`
  }
  return `uploaded file, based on v${copy.base.number}`
}

// ---------- My Saved Versions: the list of your copies ----------

export function MyVersionsPage() {
  const { navigate } = useRouter()
  const copies = useMyCopies()
  const remove = useDeleteCopy()
  const [starting, setStarting] = useState(false)
  const [confirming, setConfirming] = useState(0)
  const [error, setError] = useState('')

  const list = copies.data ?? []

  async function handleDelete(copy: MyCopy) {
    setError('')
    try {
      await remove.mutateAsync({ projectId: copy.project_id, copyId: copy.id })
      setConfirming(0)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the copy')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[16rem] flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <GitBranch className="h-4 w-4 text-faint" />
            My Saved Versions
          </h2>
          <p className="mt-0.5 text-sm text-muted">Your own copies of feature lists, to change as you like.</p>
        </div>
        <Button size="sm" onClick={() => setStarting(true)}>
          <Plus className="h-3.5 w-3.5" />
          Start a copy
        </Button>
      </div>

      <ParkedNote />

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {copies.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : copies.isError ? (
        <Card>
          <CardBody className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            Could not load your copies.
            <Button variant="secondary" size="sm" onClick={() => copies.refetch()}>
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <CardBody className="px-4 py-14 text-center">
            <p className="text-sm font-medium text-ink">No copies yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">
              Pull a project's Published list or Feature List in here, then rework it however you like without touching the
              project.
            </p>
            <Button size="sm" className="mt-3" onClick={() => setStarting(true)}>
              <Plus className="h-3.5 w-3.5" />
              Start a copy
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {list.map((copy) => {
              const when = new Date(copy.updated_at).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
              const open = () =>
                navigate({
                  name: 'myCopy',
                  copyProjectId: copy.project_id,
                  copyId: copy.id,
                })
              return (
                <li key={copy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        className="truncate text-left text-sm font-medium text-ink hover:underline"
                        onClick={open}
                      >
                        {copyTitle(copy)}
                      </button>
                      <Badge>{copy.project.name}</Badge>
                      {copy.merged_at ? (
                        <Badge tone="success" title="Merged into the project before, so it stays as it was">
                          Merged · read-only
                        </Badge>
                      ) : copy.published_at ? (
                        <Badge tone="accent" title="Shared before, so it stays as people saw it">
                          Shared · read-only
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted">
                      {copySource(copy)} · {plural(copy.feature_count, 'feature')} · edited {when}
                    </p>
                  </div>
                  {confirming === copy.id ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-danger">Delete this copy?</span>
                      <Button variant="secondary" size="sm" className="h-7" onClick={() => setConfirming(0)}>
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 bg-danger hover:bg-danger/90"
                        loading={remove.isPending}
                        onClick={() => handleDelete(copy)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button variant="secondary" size="sm" className="h-7" onClick={open}>
                        Open
                      </Button>
                      {!copy.merged_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-danger hover:bg-danger-soft hover:text-danger"
                          onClick={() => setConfirming(copy.id)}
                          aria-label={`Delete ${copyTitle(copy)}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {starting && (
        <StartWorkingCopyDialog
          onClose={() => setStarting(false)}
          onStarted={(projectId, copyId) => navigate({ name: 'myCopy', copyProjectId: projectId, copyId })}
        />
      )}
    </div>
  )
}

function StartWorkingCopyDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (projectId: number, copyId: number) => void
}) {
  const projects = useProjects({ per_page: 100 })
  const start = useStartCopy()
  const [projectId, setProjectId] = useState(0)
  const [from, setFrom] = useState<'published' | 'working'>('published')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const published = usePublished(projectId)
  const latest = published.data ?? null
  // Without anything published, the working list is the only choice.
  const source = projectId > 0 && published.isSuccess && !latest ? 'working' : from

  async function handleStart(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!projectId) {
      setError('Pick a project')
      return
    }
    try {
      const copy = await start.mutateAsync({
        projectId,
        from: source,
        name: name.trim(),
      })
      onStarted(projectId, copy.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  const choice = (value: 'published' | 'working', title: string, detail: string, disabled = false) => (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2',
        source === value ? 'border-accent bg-accent-soft/30' : 'border-border',
        disabled && 'cursor-default opacity-50',
      )}
    >
      <input
        type="radio"
        name="from"
        className="mt-0.5"
        checked={source === value}
        disabled={disabled}
        onChange={() => setFrom(value)}
      />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </label>
  )

  return (
    <Dialog title="Start a copy" onClose={onClose}>
      <form onSubmit={handleStart} noValidate>
        <div className="space-y-3 p-4">
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value={0}>Choose a project…</option>
              {(projects.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {projectId > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted">Copy from</span>
              {choice(
                'published',
                latest ? `Published #${latest.publish_number}` : 'Published',
                latest ? 'The agreed plan, as last published.' : 'Nothing has been published in this project yet.',
                published.isSuccess && !latest,
              )}
              {choice('working', 'Feature List', 'The project’s list as it is right now, including unpublished changes.')}
            </div>
          )}
          <Input
            label="Name (optional)"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Checkout rework"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={start.isPending} disabled={!projectId}>
            Start the copy
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- Feature List › Working: the copy you edited last ----------

/**
 * Opens your most recently edited copy that can still be edited, so Working
 * is where you left off. Copies shared or merged before are read-only and are
 * skipped; they stay reachable from My Saved Versions.
 */
export function MyWorkingLatest() {
  const { navigate } = useRouter()
  const copies = useMyCopies()
  const [starting, setStarting] = useState(false)

  if (copies.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (copies.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4" />
          Could not load your copies.
          <Button variant="secondary" size="sm" onClick={() => copies.refetch()}>
            Try again
          </Button>
        </CardBody>
      </Card>
    )
  }

  // Newest first, as the server sends them.
  const latest = (copies.data ?? []).find((c) => !c.published_at && !c.merged_at)
  if (latest) {
    return <CopyEditor key={latest.id} projectId={latest.project_id} copyId={latest.id} />
  }

  const others = copies.data?.length ?? 0
  return (
    <div className="space-y-4">
      <ParkedNote />
      <Card>
        <CardBody className="px-4 py-14 text-center">
          <p className="text-sm font-medium text-ink">Nothing to work on yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            Pull a project's Published list or Feature List in here, then rework it however you like without touching the
            project.
            {others > 0 && ' Your older copies are read-only; find them in My Saved Versions.'}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" onClick={() => setStarting(true)}>
              <Plus className="h-3.5 w-3.5" />
              Start a copy
            </Button>
            {others > 0 && (
              <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'myVersions' })}>
                My Saved Versions
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
      {starting && (
        <StartWorkingCopyDialog
          onClose={() => setStarting(false)}
          onStarted={(projectId, copyId) => navigate({ name: 'myCopy', copyProjectId: projectId, copyId })}
        />
      )}
    </div>
  )
}

/** Jump to another of your copies, start a new one, or see them all. */
function CopySwitcher({ projectId, copyId }: { projectId: number; copyId: number }) {
  const { navigate } = useRouter()
  const copies = useMyCopies()
  const [starting, setStarting] = useState(false)
  const list = copies.data ?? []

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={`${projectId}:${copyId}`}
        onChange={(e) => {
          const [p, c] = e.target.value.split(':').map(Number)
          navigate({ name: 'myCopy', copyProjectId: p, copyId: c })
        }}
        aria-label="Switch to another of your copies"
        className="h-8 max-w-[22rem] rounded-md border border-border bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        {!list.some((c) => c.id === copyId) && <option value={`${projectId}:${copyId}`}>This copy</option>}
        {list.map((c) => (
          <option key={c.id} value={`${c.project_id}:${c.id}`}>
            {copyTitle(c)} · {c.project.name}
            {c.published_at || c.merged_at ? ' (read-only)' : ''}
          </option>
        ))}
      </select>
      <Button variant="secondary" size="sm" className="h-8" onClick={() => setStarting(true)}>
        <Plus className="h-3.5 w-3.5" />
        New copy
      </Button>
      <Button variant="ghost" size="sm" className="h-8" onClick={() => navigate({ name: 'myVersions' })}>
        All in My Saved Versions
      </Button>
      {starting && (
        <StartWorkingCopyDialog
          onClose={() => setStarting(false)}
          onStarted={(p, c) => navigate({ name: 'myCopy', copyProjectId: p, copyId: c })}
        />
      )}
    </div>
  )
}

// ---------- one copy, open for editing ----------

/** Indent per level, in pixels, as in the project's lists. */
const INDENT = 20

interface DragState {
  key: string
  /** Row indexes of the dragged feature and everything inside it. */
  excluded: Set<number>
  height: number
  depth: number
  startX: number
  y: number
  target: DropTarget | null
  mark: { top: number; height: number } | null
}

export function CopyEditor({ projectId, copyId }: { projectId: number; copyId: number }) {
  const { navigate } = useRouter()
  const copy = useCopy(projectId, copyId)
  const save = useSaveCopyList(projectId, copyId)

  const [rows, setRows] = useState<CopyRow[] | null>(null)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [startingNew, setStartingNew] = useState(false)
  // A delete asked for from a row's trash button, confirmed in the side panel.
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Bumped on every edit; the save sends what was there when it started.
  const [edits, setEdits] = useState(0)
  const [savedEdits, setSavedEdits] = useState(0)
  const revision = useRef(0)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Loaded once; from then on the page's own rows are the truth.
  useEffect(() => {
    if (copy.data && rows === null) {
      setRows(rowsFromSnapshot(copy.data.snapshot.features))
      setName(copy.data.name)
      revision.current = copy.data.revision
    }
  }, [copy.data, rows])

  /**
   * Applies an edit to the latest rows, not the ones this render saw, so
   * edits made in quick succession build on each other instead of each
   * undoing the one before.
   */
  function change(edit: (current: CopyRow[]) => CopyRow[]) {
    if (readOnly) return
    setRows((current) => (current ? edit(current) : current))
    setEdits((n) => n + 1)
  }

  // Save a moment after the last edit.
  const readOnly = Boolean(copy.data?.published_at || copy.data?.merged_at)
  useEffect(() => {
    if (edits === savedEdits || !rows || readOnly || save.isPending) return
    const timer = window.setTimeout(async () => {
      const sending = edits
      setError('')
      try {
        const saved = await save.mutateAsync({
          revision: revision.current,
          name,
          features: rowsForSave(rows),
        })
        revision.current = saved.revision
        setSavedEdits(sending)
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not save. Check the connection; your changes are still here.',
        )
        // Stop retrying until the next edit.
        setSavedEdits(sending)
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [edits, savedEdits, rows, name, readOnly, save])

  // Leaving with unsaved edits asks first.
  const unsaved = edits !== savedEdits || save.isPending
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const depth = useMemo(() => (rows ? depths(rows) : new Map<string, number>()), [rows])

  // ----- dragging, as in the project's Working list -----

  function locate(state: DragState, x: number, y: number): Pick<DragState, 'target' | 'mark'> {
    const list = listRef.current
    if (!list || !rows) return { target: null, mark: null }
    const top = list.getBoundingClientRect().top
    const dropRows: DropRow[] = []
    const rects: DOMRect[] = []
    for (const el of Array.from(list.querySelectorAll<HTMLElement>('[data-row]'))) {
      const index = Number(el.dataset.row)
      if (state.excluded.has(index)) continue
      const parentKey = rows[index].parent
      dropRows.push({
        id: index,
        depth: depth.get(rows[index].key) ?? 0,
        parentId: parentKey === null ? null : rows.findIndex((r) => r.key === parentKey),
      })
      rects.push(el.getBoundingClientRect())
    }
    const wanted = state.depth + Math.round((x - state.startX) / INDENT)
    const atGap = (gap: number) => {
      const target = gapTarget(dropRows, gap, wanted, state.height)
      const lineTop = gap < rects.length ? rects[gap].top : (rects[rects.length - 1]?.bottom ?? top)
      return {
        target,
        mark: target ? { top: lineTop - top, height: 0 } : null,
      }
    }
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      const quarter = r.height / 4
      if (y < r.top + quarter) return atGap(i)
      if (y <= r.bottom - quarter) {
        const target = intoTarget(dropRows, i, state.height)
        if (target) return { target, mark: { top: r.top - top, height: r.height } }
        return atGap(y < r.top + r.height / 2 ? i : i + 1)
      }
    }
    return atGap(dropRows.length)
  }

  function startDrag(row: CopyRow, event: ReactPointerEvent) {
    if (!rows || readOnly) return
    event.preventDefault()
    const [start, end] = branchRange(rows, row.key)
    const excluded = new Set<number>()
    for (let i = start; i < end; i++) excluded.add(i)
    const state: DragState = {
      key: row.key,
      excluded,
      height: branchHeight(rows, row.key),
      depth: depth.get(row.key) ?? 0,
      startX: event.clientX,
      y: event.clientY,
      target: null,
      mark: null,
    }
    Object.assign(state, locate(state, event.clientX, event.clientY))
    dragRef.current = state
    setDrag(state)
  }

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const scroller = listRef.current?.closest('main')
    const move = (e: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const next = {
        ...current,
        y: e.clientY,
        ...locate(current, e.clientX, e.clientY),
      }
      dragRef.current = next
      setDrag(next)
    }
    const tick = window.setInterval(() => {
      const current = dragRef.current
      if (!current || !scroller) return
      const box = scroller.getBoundingClientRect()
      if (current.y < box.top + 60) scroller.scrollBy(0, -14)
      else if (current.y > box.bottom - 60) scroller.scrollBy(0, 14)
    }, 30)
    const finish = (drop: boolean) => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!drop || !current?.target || !rows) return
      const parentKey = current.target.parentId === null ? null : rows[current.target.parentId].key
      const { key, target } = current
      change((now) => moveBranch(now, key, parentKey, target.index))
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    const previousSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      window.clearInterval(tick)
      document.body.style.userSelect = previousSelect
    }
    // locate and rows are read through the latest render; the listeners only
    // need setting up once per drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  // ----- the page -----

  if (copy.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {copy.error instanceof ApiError ? copy.error.message : 'Could not open this copy'}
          </span>
        </CardBody>
      </Card>
    )
  }
  if (!copy.data || !rows) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const data = copy.data
  const current = selected ? (rows.find((r) => r.key === selected) ?? null) : null

  function add(parent: string | null) {
    const key = newKey()
    change((now) => addRow(now, parent, 'New feature', key).rows)
    setSelected(key)
    setRenaming(key)
  }

  function remove(key: string) {
    change((now) => deleteBranch(now, key))
    setSelected(null)
    setDeleting(null)
  }

  const status = readOnly ? 'readonly' : save.isPending || edits !== savedEdits ? 'saving' : error ? 'error' : 'saved'

  return (
    <div className="space-y-4">
      <CopySwitcher projectId={projectId} copyId={copyId} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[16rem] flex-1">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setEdits((n) => n + 1)
            }}
            placeholder={`Copy ${data.number}`}
            maxLength={80}
            disabled={readOnly}
            aria-label="Name of this copy"
            className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-ink hover:border-border focus:border-accent focus:outline-none"
          />
          <p className="px-1 text-xs text-muted">
            {data.snapshot.project.name} · {copySource(data)} · {plural(rows.length, 'feature')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn('flex items-center gap-1 text-xs', status === 'error' ? 'text-danger' : 'text-faint')}
            aria-live="polite"
          >
            {status === 'readonly' ? (
              <>
                <Lock className="h-3 w-3" /> Read-only
              </>
            ) : status === 'saving' ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </>
            ) : status === 'error' ? (
              'Not saved'
            ) : (
              <>
                <Check className="h-3 w-3" /> Saved
              </>
            )}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadCopyFile(projectId, copyId)}
            disabled={unsaved}
            title={
              unsaved
                ? 'Wait for the save to finish'
                : 'Download as .md to edit offline; upload it on the project’s Versions page'
            }
          >
            <Download className="h-3.5 w-3.5" />
            .md
          </Button>
          {!readOnly && (
            <Button size="sm" onClick={() => add(null)}>
              <Plus className="h-3.5 w-3.5" />
              Add feature
            </Button>
          )}
        </div>
      </div>

      <ParkedNote />

      {startingNew && (
        <StartWorkingCopyDialog
          onClose={() => setStartingNew(false)}
          onStarted={(p, c) => navigate({ name: 'myCopy', copyProjectId: p, copyId: c })}
        />
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="secondary" size="sm" className="h-7" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
      {readOnly && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning bg-warning-soft px-3 py-2.5 text-sm text-ink">
          <Lock className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-medium">This copy is read-only.</span>{' '}
            <span className="text-muted">
              It was {data.merged_at ? 'merged into the project' : 'shared with the team'} before, so it stays as it
              was. To make changes, start a new copy.
            </span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => setStartingNew(true)}>
            Start a new copy
          </Button>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          {rows.length === 0 ? (
            <CardBody className="py-12 text-center text-sm text-muted">
              Empty.{' '}
              {!readOnly && (
                <button type="button" className="text-accent hover:underline" onClick={() => add(null)}>
                  Add the first feature
                </button>
              )}
            </CardBody>
          ) : (
            <div ref={listRef} className="relative divide-y divide-border">
              {rows.map((row, index) => {
                const d = depth.get(row.key) ?? 0
                const moving = drag?.excluded.has(index) ?? false
                return (
                  <div
                    key={row.key}
                    data-row={index}
                    onClick={() => setSelected(row.key)}
                    className={cn(
                      'group/row relative flex cursor-pointer items-center gap-2 py-2 pr-3',
                      selected === row.key ? 'bg-accent-soft/40' : 'hover:bg-raised',
                      moving && 'opacity-40',
                    )}
                    style={{ paddingLeft: 8 + d * INDENT }}
                  >
                    {Array.from({ length: d }).map((_, i) => (
                      <span
                        key={i}
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-border"
                        style={{ left: 8 + 26 + i * INDENT }}
                      />
                    ))}
                    {!readOnly && (
                      <button
                        type="button"
                        onPointerDown={(e) => startDrag(row, e)}
                        onClick={(e) => e.stopPropagation()}
                        className="grid h-6 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-faint hover:text-ink active:cursor-grabbing"
                        aria-label={`Drag ${row.title}`}
                        title="Drag to move or re-nest"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <span className="shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint">
                      L{d}
                    </span>
                    {renaming === row.key ? (
                      <input
                        autoFocus
                        defaultValue={row.title}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => {
                          const title = e.currentTarget.value.trim()
                          if (title && title !== row.title) change((now) => updateRow(now, row.key, { title }))
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className="h-7 min-w-0 flex-1 rounded border border-accent bg-surface px-2 text-sm text-ink focus:outline-none"
                      />
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-ink"
                        onDoubleClick={() => !readOnly && setRenaming(row.key)}
                        title={readOnly ? undefined : 'Double-click to rename'}
                      >
                        {row.title}
                      </span>
                    )}
                    {row.featureId === 0 && <Badge tone="accent">new</Badge>}
                    {!readOnly && d < MAX_DEPTH && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          add(row.key)
                        }}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border text-muted transition hover:border-accent hover:text-accent [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100"
                        title={`Add a feature inside ${row.title}`}
                        aria-label={`Add a feature inside ${row.title}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelected(row.key)
                          setDeleting(row.key)
                        }}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border text-muted transition hover:border-danger hover:text-danger [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100"
                        title={`Delete ${row.title}`}
                        aria-label={`Delete ${row.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <StatusPill status={row.status as FeatureStatus} />
                    <span className="hidden sm:inline">
                      <PriorityPill priority={row.priority as FeaturePriority} />
                    </span>
                  </div>
                )
              })}

              {drag?.mark && drag.target && (
                <div
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute right-2 z-20',
                    drag.mark.height > 0
                      ? 'rounded-md border-2 border-accent bg-accent-soft/30'
                      : 'h-0.5 rounded-full bg-accent',
                  )}
                  style={{
                    top: drag.mark.height > 0 ? drag.mark.top : drag.mark.top - 1,
                    height: drag.mark.height > 0 ? drag.mark.height : undefined,
                    left: drag.mark.height > 0 ? 4 : 8 + 26 + drag.target.depth * INDENT,
                  }}
                />
              )}

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => add(null)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add feature
                </button>
              )}
            </div>
          )}
        </Card>

        <div className="lg:sticky lg:top-4 lg:col-span-2">
          {current ? (
            <FeaturePanel
              key={current.key + (deleting === current.key ? ':delete' : '')}
              row={current}
              startConfirming={deleting === current.key}
              depth={depth.get(current.key) ?? 0}
              readOnly={readOnly}
              onChange={(fields) => change((now) => updateRow(now, current.key, fields))}
              onDelete={() => remove(current.key)}
              onAddInside={() => add(current.key)}
            />
          ) : (
            <Card>
              <CardBody className="py-10 text-center text-sm text-muted">
                {readOnly
                  ? 'Click a feature to read its description and notes.'
                  : 'Click a feature to edit it. Use “Add feature” to add one, the + on a row to add one inside it, the trash icon to delete, double-click to rename, and the handle to drag.'}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

/** The selected feature: its name, status, priority, description and notes. */
function FeaturePanel({
  row,
  depth,
  readOnly,
  startConfirming = false,
  onChange,
  onDelete,
  onAddInside,
}: {
  row: CopyRow
  depth: number
  readOnly: boolean
  /** Opened from a row's trash button: ask about deleting straight away. */
  startConfirming?: boolean
  onChange: (change: Partial<CopyRow>) => void
  onDelete: () => void
  onAddInside: () => void
}) {
  const files = useFeatureAttachments(row.featureId)
  const attachments = files.data?.items ?? []
  const [title, setTitle] = useState(row.title)
  // Renamed elsewhere, such as in the list: show the new name.
  useEffect(() => setTitle(row.title), [row.title])
  const [confirming, setConfirming] = useState(startConfirming)

  const pick = <T extends string>(value: T, current: string, label: string, set: (v: T) => void) => (
    <button
      key={value}
      type="button"
      disabled={readOnly}
      onClick={() => set(value)}
      aria-pressed={current === value}
      className={cn(
        'rounded px-2 py-1 text-xs transition-colors',
        current === value ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {label}
    </button>
  )

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint">
            L{depth}
          </span>
          <input
            value={title}
            disabled={readOnly}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== row.title && onChange({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Feature name"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink hover:border-border focus:border-accent focus:outline-none"
          />
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
            {depth < MAX_DEPTH && (
              <Button variant="secondary" size="sm" onClick={onAddInside}>
                <Plus className="h-3.5 w-3.5" />
                Add inside
              </Button>
            )}
            <span className="flex-1" />
            {confirming ? (
              <>
                <span className="text-xs text-danger">Delete it and everything inside?</span>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
                <Button size="sm" className="bg-danger hover:bg-danger/90" onClick={onDelete}>
                  Delete
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger-soft hover:text-danger"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-14 text-2xs font-medium uppercase tracking-wider text-faint">Status</span>
            {(Object.keys(STATUS_LABEL) as FeatureStatus[]).map((s) =>
              pick(s, row.status, STATUS_LABEL[s], (v) => onChange({ status: v })),
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-14 text-2xs font-medium uppercase tracking-wider text-faint">Priority</span>
            {(Object.keys(PRIORITY_LABEL) as FeaturePriority[]).map((p) =>
              pick(p, row.priority, PRIORITY_LABEL[p], (v) => onChange({ priority: v })),
            )}
          </div>
        </div>

        {readOnly ? (
          <>
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">Description</h3>
              {row.description.trim() ? (
                <Markdown text={row.description} attachments={attachments} />
              ) : (
                <p className="text-sm text-faint">No description.</p>
              )}
            </section>
            {row.notes.trim() && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">Notes</h3>
                <Markdown text={row.notes} attachments={attachments} />
              </section>
            )}
          </>
        ) : (
          <>
            <MarkdownEditor
              id={`copy-description-${row.key}`}
              label="Description"
              value={row.description}
              onChange={(description) => onChange({ description })}
              featureId={row.featureId}
              attachments={attachments}
              height="30vh"
              canUpload={false}
              focusOnOpen={false}
            />
            <MarkdownEditor
              id={`copy-notes-${row.key}`}
              label="Notes"
              value={row.notes}
              onChange={(notes) => onChange({ notes })}
              featureId={row.featureId}
              attachments={attachments}
              height="20vh"
              placeholder="Working notes: open questions, decisions, links…"
              canUpload={false}
              focusOnOpen={false}
            />
          </>
        )}
      </CardBody>
    </Card>
  )
}
