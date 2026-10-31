import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Download,
  GripVertical,
  History,
  ListChecks,
  Loader2,
  Palette,
  RefreshCw,
  Send,
  Plus,
  Users,
  X,
} from 'lucide-react'
import {
  useClearColors,
  useCreateFeature,
  useFeatures,
  useMoveFeature,
  useProject,
  useProjectTags,
  useProjectVisit,
  useUpdateFeature,
} from '@/lib/queries'
import { gapTarget, intoTarget, MAX_DEPTH, type DropRow, type DropTarget } from '@/lib/tree-drop'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { downloadFeatureFile, FEATURE_FILE_NAME } from '@/lib/feature-file'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, PriorityPill, TagList } from '@/components/FeatureBits'
import { NewFeatureDialog } from './NewFeatureDialog'
import { ColorDot } from '@/components/FeatureColor'
import { ShareDialog } from './ShareDialog'
import { PublishDialog } from './PublishDialog'
import { cn, percent, plural } from '@/lib/utils'
import { ROLE_LABEL, STATUS_LABEL, canManage, type Feature, type FeatureStatus } from '@/lib/types'

const STATUSES: FeatureStatus[] = ['todo', 'in_progress', 'done']

const NO_FILTERS = { status: [], tag: '', q: '' }

/**
 * One feature in the list's outline. Depth is the level the canvas calls
 * L0, L1, L2. A context row is a parent shown only because something under it
 * matches the filters; it is drawn dimmed.
 */
interface TreeNode {
  feature: Feature
  depth: number
  children: TreeNode[]
  context: boolean
  /** All its parts, done or not, even those a filter hides. */
  parts: { done: number; total: number }
}

/**
 * Nests features under their parents, keeping the list's order among
 * siblings. A feature whose parent is not in the list, or that sits in a loop
 * of parents, goes at the top level rather than vanishing.
 *
 * With `matches` set, only the matches and the parents above them are kept.
 */
function buildTree(all: Feature[], matches: Feature[] | null): TreeNode[] {
  // Siblings in the order people arranged them; older features without a
  // saved place keep the order they were added in.
  all = [...all].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
  const byId = new Map(all.map((f) => [f.id, f]))
  const kids = new Map<number, Feature[]>()
  const roots: Feature[] = []

  for (const f of all) {
    const parent = f.parent_feature_id
    if (parent != null && parent !== f.id && byId.has(parent) && !inLoop(f, byId)) {
      kids.set(parent, [...(kids.get(parent) ?? []), f])
    } else {
      roots.push(f)
    }
  }

  let keep: Set<number> | null = null
  const matched = new Set(matches?.map((f) => f.id) ?? [])
  if (matches) {
    keep = new Set()
    for (const f of matches) {
      let current: Feature | undefined = byId.get(f.id) ?? f
      while (current && !keep.has(current.id)) {
        keep.add(current.id)
        const parent: number | null = current.parent_feature_id
        current = parent != null && !inLoop(current, byId) ? byId.get(parent) : undefined
      }
    }
  }

  const grow = (f: Feature, depth: number): TreeNode => ({
    feature: f,
    depth,
    children: (kids.get(f.id) ?? [])
      .filter((child) => !keep || keep.has(child.id))
      .map((child) => grow(child, depth + 1)),
    context: matches !== null && !matched.has(f.id),
    parts: {
      done: (kids.get(f.id) ?? []).filter((child) => child.status === 'done').length,
      total: (kids.get(f.id) ?? []).length,
    },
  })

  return roots.filter((f) => !keep || keep.has(f.id)).map((f) => grow(f, 0))
}

/** True when following parents from f comes back round to f. */
function inLoop(f: Feature, byId: Map<number, Feature>): boolean {
  const seen = new Set<number>([f.id])
  let parent = f.parent_feature_id
  while (parent != null) {
    if (seen.has(parent)) return parent === f.id
    seen.add(parent)
    parent = byId.get(parent)?.parent_feature_id ?? null
  }
  return false
}

function walk(nodes: TreeNode[], visit: (node: TreeNode) => void) {
  for (const node of nodes) {
    visit(node)
    walk(node.children, visit)
  }
}

/** How many levels a node's branch goes below it: 0 for a feature with nothing inside. */
function heightOf(node: TreeNode): number {
  return node.children.length === 0 ? 0 : 1 + Math.max(...node.children.map(heightOf))
}

/** What a drag is doing: which feature, where it started, and where it would land. */
interface DragState {
  node: TreeNode
  /** The feature and everything inside it: not places it can go. */
  excluded: Set<number>
  startX: number
  x: number
  y: number
  target: DropTarget | null
  /** Where to draw the drop line or the "inside" box, relative to the list. */
  mark: { top: number; height: number } | null
}

/** The rows to draw: every node whose parents are all open. */
function visibleRows(nodes: TreeNode[], isOpen: (node: TreeNode) => boolean): TreeNode[] {
  const out: TreeNode[] = []
  const add = (list: TreeNode[]) => {
    for (const node of list) {
      out.push(node)
      if (isOpen(node)) add(node.children)
    }
  }
  add(nodes)
  return out
}

/**
 * The Working feature list: a project's features as they are being
 * worked on, with filters. This is where the list is edited, and where it is
 * published from; the published list is its own screen (PublishedList).
 *
 * Filter state is deliberately local rather than in the URL: these are a
 * working view rather than something to link to, and keeping them out of the
 * URL means the back button returns to the previous screen instead of
 * unwinding a trail of filter changes.
 */
export function ProjectDetail({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()

  const [statuses, setStatuses] = useState<FeatureStatus[]>([])
  const [tag, setTag] = useState('')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [recentOnly, setRecentOnly] = useState(false)

  // When you last opened this list: undefined until the server answers, null
  // on a first visit. Asked once per visit, which also records this one, so
  // the next visit counts from now.
  const [since, setSince] = useState<string | null | undefined>(undefined)
  const recordVisit = useProjectVisit(projectId)
  const visited = useRef(false)
  useEffect(() => {
    if (visited.current) return
    visited.current = true
    recordVisit.mutate(undefined, {
      onSuccess: (visit) => setSince(visit.previous),
      onError: () => setSince(null),
    })
  }, [recordVisit])

  const filters = useMemo(() => ({ status: statuses, tag, q: search }), [statuses, tag, search])

  const project = useProject(projectId)
  const features = useFeatures(projectId, filters)
  // The whole list, so a filtered match can still be shown under its parents.
  // With no filters set this is the same query as the one above.
  const allFeatures = useFeatures(projectId, NO_FILTERS)
  const tags = useProjectTags(projectId)
  const createFeature = useCreateFeature(projectId)

  // Where the quick-add box is open: under a feature (its id), at the end of
  // the list for a top-level feature ('top'), or nowhere.
  const [addingTo, setAddingTo] = useState<number | 'top' | null>(null)

  async function addFeature(title: string, parentId: number | null) {
    await createFeature.mutateAsync({
      title,
      ...(parentId !== null ? { parent_feature_id: parentId } : {}),
    })
    // A child added under a closed feature should be seen, so its parent opens.
    if (parentId !== null) setOpen((current) => ({ ...current, [parentId]: true }))
  }

  // What changed since your last visit: new features, and ones edited since.
  const changes = useMemo(() => {
    const out = new Map<number, 'new' | 'changed'>()
    if (!since) return out
    const last = new Date(since).getTime()
    for (const f of allFeatures.data?.items ?? []) {
      if (new Date(f.created_at).getTime() > last) out.set(f.id, 'new')
      else if (new Date(f.updated_at).getTime() > last) out.set(f.id, 'changed')
    }
    return out
  }, [since, allFeatures.data])

  const hasFilters = statuses.length > 0 || tag !== '' || search !== '' || recentOnly
  const fetched = useMemo(() => features.data?.items ?? [], [features.data])
  const items = useMemo(
    () => (recentOnly ? fetched.filter((f) => changes.has(f.id)) : fetched),
    [recentOnly, fetched, changes],
  )

  // Which parents are open, by feature id. Unset means the default: L0 open,
  // deeper levels closed, so a big project opens on its outline.
  const [open, setOpen] = useState<Record<number, boolean>>({})

  // Arrange mode: every row gets a handle and can be dragged, with a mouse or
  // a finger. Off, the list behaves as usual, so nothing moves by accident.
  const [arranging, setArranging] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const moveFeature = useMoveFeature(projectId)
  const updateFeature = useUpdateFeature(projectId)
  const clearColors = useClearColors(projectId)
  const [clearingColors, setClearingColors] = useState(false)
  const [moveError, setMoveError] = useState('')
  const tree = useMemo(
    () => buildTree(allFeatures.data?.items ?? items, hasFilters ? items : null),
    [allFeatures.data, items, hasFilters],
  )
  const isOpen = (node: TreeNode) => hasFilters || (open[node.feature.id] ?? node.depth === 0)
  const rows = visibleRows(tree, isOpen)
  const hasNesting = tree.some((node) => node.children.length > 0)

  /**
   * Where a drag at (x, y) would land. Rows are read from the page, so the
   * answer matches what is on screen: above the top quarter of a row is the
   * gap before it, the middle half is inside it, and sliding right or left
   * from where the drag started picks a deeper or shallower level.
   */
  function locate(state: DragState, x: number, y: number): Pick<DragState, 'target' | 'mark'> {
    const list = listRef.current
    if (!list) return { target: null, mark: null }
    const top = list.getBoundingClientRect().top
    const rows: DropRow[] = []
    const rects: DOMRect[] = []
    for (const el of Array.from(list.querySelectorAll<HTMLElement>('[data-row-id]'))) {
      const id = Number(el.dataset.rowId)
      if (state.excluded.has(id)) continue
      rows.push({ id, depth: Number(el.dataset.depth), parentId: el.dataset.parent ? Number(el.dataset.parent) : null })
      rects.push(el.getBoundingClientRect())
    }
    const wanted = state.node.depth + Math.round((x - state.startX) / INDENT)
    const height = heightOf(state.node)
    const atGap = (gap: number) => {
      const target = gapTarget(rows, gap, wanted, height)
      const lineTop = gap < rects.length ? rects[gap].top : (rects[rects.length - 1]?.bottom ?? top)
      return { target, mark: target ? { top: lineTop - top, height: 0 } : null }
    }
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      const quarter = r.height / 4
      if (y < r.top + quarter) return atGap(i)
      if (y <= r.bottom - quarter) {
        const target = intoTarget(rows, i, height)
        if (target) return { target, mark: { top: r.top - top, height: r.height } }
        return atGap(y < r.top + r.height / 2 ? i : i + 1)
      }
    }
    return atGap(rows.length)
  }

  function startDrag(node: TreeNode, event: ReactPointerEvent) {
    event.preventDefault()
    setMoveError('')
    const excluded = new Set<number>()
    walk([node], (n) => excluded.add(n.feature.id))
    const state: DragState = {
      node,
      excluded,
      startX: event.clientX,
      x: event.clientX,
      y: event.clientY,
      target: null,
      mark: null,
    }
    Object.assign(state, locate(state, event.clientX, event.clientY))
    dragRef.current = state
    setDrag(state)
  }

  // While dragging: follow the pointer anywhere on the page, scroll near the
  // top and bottom edges, and drop on release.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const scroller = listRef.current?.closest('main')
    const move = (e: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const next = { ...current, x: e.clientX, y: e.clientY, ...locate(current, e.clientX, e.clientY) }
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
      if (!drop || !current?.target) return
      const { node, target } = current
      const parentId = node.depth === 0 ? null : node.feature.parent_feature_id
      // Dropped back where it was: nothing to do.
      const siblings = parentId === null ? tree : (findNode(tree, parentId)?.children ?? [])
      const here = siblings.findIndex((n) => n.feature.id === node.feature.id)
      if (target.parentId === parentId && target.index === here) return
      moveFeature.mutate(
        { id: node.feature.id, parentId: target.parentId, index: target.index },
        {
          onSuccess: () => {
            if (target.parentId !== null) setOpen((now) => ({ ...now, [target.parentId!]: true }))
          },
          onError: (err) => setMoveError(err instanceof ApiError ? err.message : 'Could not move the feature'),
        },
      )
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
    // locate and the tree are read through the latest render; the listeners only
    // need setting up once per drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  function setAllOpen(value: boolean) {
    const next: Record<number, boolean> = {}
    walk(tree, (node) => {
      if (node.children.length > 0) next[node.feature.id] = value
    })
    setOpen(next)
  }

  function toggleStatus(status: FeatureStatus) {
    setStatuses((current) => (current.includes(status) ? current.filter((s) => s !== status) : [...current, status]))
  }

  function clearFilters() {
    setStatuses([])
    setTag('')
    setSearch('')
    setRecentOnly(false)
  }

  if (project.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {project.error instanceof ApiError ? project.error.message : 'Could not load project'}
          </span>
        </CardBody>
      </Card>
    )
  }

  const stats = project.data?.stats
  const role = project.data?.my_role
  // Until the role is known, show the editing buttons rather than flicker them in.
  const canEdit = role !== 'viewer'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-8 w-8 shrink-0 p-0"
          onClick={() => navigate({ name: 'projects' })}
          aria-label="Back to projects"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-[16rem] flex-1">
          {project.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-ink">{project.data?.name}</h2>
                <Badge tone="accent" className="shrink-0 whitespace-nowrap">
                  Feature List
                </Badge>
                {role && role !== 'owner' && (
                  <Badge
                    tone={role === 'admin' ? 'warning' : 'neutral'}
                    title={
                      role === 'admin'
                        ? 'You are opening this as the server’s admin'
                        : `Shared with you as ${ROLE_LABEL[role].toLowerCase()}`
                    }
                  >
                    {ROLE_LABEL[role]}
                  </Badge>
                )}
              </div>
              {project.data?.description && <p className="mt-0.5 text-sm text-muted">{project.data.description}</p>}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <RefreshButton />
          <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
            <Users className="h-3.5 w-3.5" />
            Share
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setPublishing(true)} title="Make this list the published one">
              <Send className="h-3.5 w-3.5" />
              Publish
            </Button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Features" value={stats.feature_count} />
          <MiniStat label="Done" value={stats.completed_features} tone="success" />
          <MiniStat label="Tasks" value={stats.task_count} />
          <MiniStat label="Progress" value={`${percent(stats.completed_features, stats.feature_count)}%`} />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          {!arranging && (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search features…"
                aria-label="Search features"
                className="h-7 w-48 rounded-md border border-border bg-bg px-2.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />

              <div className="flex gap-1">
                {STATUSES.map((status) => (
                  <FilterChip key={status} active={statuses.includes(status)} onClick={() => toggleStatus(status)}>
                    {STATUS_LABEL[status]}
                  </FilterChip>
                ))}
              </div>

              {(tags.data?.items.length ?? 0) > 0 && (
                <>
                  <div className="mx-1 h-5 w-px bg-border" />
                  <div className="flex flex-wrap gap-1">
                    {tags.data?.items.slice(0, 8).map((t) => (
                      <FilterChip
                        key={t.name}
                        active={tag === t.name}
                        onClick={() => setTag(tag === t.name ? '' : t.name)}
                      >
                        {t.name}
                        <span className="ml-1 text-faint">{t.count}</span>
                      </FilterChip>
                    ))}
                  </div>
                </>
              )}

              {canEdit &&
                (allFeatures.data?.items ?? []).some((f) => f.color) &&
                (clearingColors ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-danger">Remove every colour, for everyone?</span>
                    <Button variant="secondary" size="sm" className="h-7" onClick={() => setClearingColors(false)}>
                      Keep
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 bg-danger hover:bg-danger/90"
                      loading={clearColors.isPending}
                      onClick={() =>
                        clearColors.mutate(undefined, {
                          onSettled: () => setClearingColors(false),
                          onError: (err) =>
                            setMoveError(err instanceof ApiError ? err.message : 'Could not remove the colours'),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7"
                    onClick={() => setClearingColors(true)}
                    title="Take the colour off every feature in this project"
                  >
                    <Palette className="h-3 w-3" />
                    Remove colours
                  </Button>
                ))}

              <Button
                variant={recentOnly ? 'primary' : 'secondary'}
                size="sm"
                className="h-7"
                aria-pressed={recentOnly}
                disabled={!since}
                onClick={() => setRecentOnly((v) => !v)}
                title={
                  since === undefined
                    ? 'Checking your last visit…'
                    : since === null
                      ? 'From your next visit, what changed since this one shows here'
                      : `Show only what is new or changed since your last visit (${when(since)})`
                }
              >
                <Clock className="h-3 w-3" />
                Recent changes
                {since && <span className={cn('tabular-nums', !recentOnly && 'text-faint')}>{changes.size}</span>}
              </Button>
            </>
          )}

          {canEdit && items.length > 0 && (
            <Button
              variant={arranging ? 'primary' : 'secondary'}
              size="sm"
              className="h-7"
              disabled={hasFilters && !arranging}
              onClick={() => {
                setArranging((v) => !v)
                setAddingTo(null)
                setMoveError('')
              }}
              aria-pressed={arranging}
              title={
                hasFilters && !arranging
                  ? 'Clear the filters to arrange the whole list'
                  : arranging
                    ? 'Stop arranging'
                    : 'Drag features to reorder them or move them between levels'
              }
            >
              {arranging ? <Check className="h-3 w-3" /> : <GripVertical className="h-3 w-3" />}
              {arranging ? 'Done arranging' : 'Arrange'}
            </Button>
          )}

          {!arranging && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="h-7"
                onClick={() => navigate({ name: 'versions', projectId })}
              >
                <History className="h-3 w-3" />
                Versions
              </Button>
              <DownloadFileButton projectId={projectId} />
              {canEdit && (
                <Button size="sm" className="h-7" onClick={() => setCreating(true)}>
                  <Plus className="h-3 w-3" />
                  Add feature
                </Button>
              )}
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-7" onClick={clearFilters}>
                  <X className="h-3 w-3" />
                  Clear
                </Button>
              )}
            </>
          )}

          {hasNesting && !hasFilters && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setAllOpen(true)}
                title="Show every level"
              >
                <ChevronsUpDown className="h-3 w-3" />
                Expand all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setAllOpen(false)}
                title="Show top-level features only"
              >
                <ChevronsDownUp className="h-3 w-3" />
                Collapse all
              </Button>
            </div>
          )}
        </div>

        <CardBody className="p-0">
          {features.isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-4 w-56" />
                </div>
              ))}
            </div>
          ) : features.isError ? (
            <div className="px-4 py-12 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-soft text-danger">
                <AlertCircle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">Could not load features</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                {features.error instanceof ApiError ? features.error.message : 'The server could not be reached.'}
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => features.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
                <ListChecks className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">
                {recentOnly && since && !(statuses.length > 0 || tag !== '' || search !== '')
                  ? `Nothing has changed since your last visit (${when(since)})`
                  : hasFilters
                    ? 'No features match these filters'
                    : 'No features yet'}
              </p>
              {hasFilters ? (
                <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                canEdit && (
                  <Button size="sm" className="mt-3" onClick={() => setCreating(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add the first feature
                  </Button>
                )
              )}
            </div>
          ) : (
            <div
              ref={listRef}
              className={cn(
                'relative divide-y divide-border transition-opacity',
                (features.isFetching || moveFeature.isPending) && 'opacity-60',
              )}
            >
              {arranging && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-accent-soft/40 px-4 py-2 text-xs text-muted">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    Drag a feature by its handle. Drop it between rows to place it there (slide right or left for a
                    deeper or higher level), or onto a row to put it inside. Features go down to L{MAX_DEPTH}.
                  </span>
                  {moveError && <span className="text-danger">{moveError}</span>}
                </div>
              )}
              {rows.map((node) => (
                <div key={node.feature.id} className="divide-y divide-border">
                  <FeatureRow
                    node={node}
                    arranging={arranging}
                    onGrab={(e) => startDrag(node, e)}
                    moving={drag?.excluded.has(node.feature.id) ?? false}
                    open={isOpen(node)}
                    canToggle={!hasFilters}
                    onToggle={() => setOpen((current) => ({ ...current, [node.feature.id]: !isOpen(node) }))}
                    onOpen={() => navigate({ name: 'feature', projectId, featureId: node.feature.id, editable: true })}
                    adding={addingTo === node.feature.id}
                    change={changes.get(node.feature.id)}
                    onColor={
                      canEdit
                        ? (color) =>
                            updateFeature.mutate(
                              { id: node.feature.id, color },
                              {
                                onError: (err) =>
                                  setMoveError(err instanceof ApiError ? err.message : 'Could not change the colour'),
                              },
                            )
                        : undefined
                    }
                    onAddInside={
                      canEdit && !hasFilters && !arranging && node.depth < MAX_DEPTH
                        ? () => setAddingTo(addingTo === node.feature.id ? null : node.feature.id)
                        : undefined
                    }
                  />
                  {addingTo === node.feature.id && (
                    <QuickAddRow
                      depth={node.depth + 1}
                      placeholder={`New feature in ${node.feature.title}`}
                      onAdd={(title) => addFeature(title, node.feature.id)}
                      onClose={() => setAddingTo(null)}
                    />
                  )}
                </div>
              ))}

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
                    left: drag.mark.height > 0 ? 8 : ARRANGE_GUTTER + LEAD + drag.target.depth * INDENT,
                  }}
                />
              )}

              {canEdit &&
                !hasFilters &&
                !arranging &&
                (addingTo === 'top' ? (
                  <QuickAddRow
                    depth={0}
                    placeholder="New top-level feature"
                    onAdd={(title) => addFeature(title, null)}
                    onClose={() => setAddingTo(null)}
                  />
                ) : (
                  <button
                    onClick={() => setAddingTo('top')}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add feature
                  </button>
                ))}
            </div>
          )}
        </CardBody>
      </Card>

      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex max-w-xs items-center gap-2 rounded-md border border-accent bg-surface px-2.5 py-1.5 text-xs text-ink shadow-pop"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate font-medium">{drag.node.feature.title}</span>
          <span className={cn('shrink-0 font-mono text-2xs', drag.target ? 'text-accent' : 'text-danger')}>
            {drag.target
              ? drag.target.into !== undefined
                ? `inside, L${drag.target.depth}`
                : `L${drag.target.depth}`
              : `can't go here (L${MAX_DEPTH} max)`}
          </span>
        </div>
      )}

      {items.length > 0 && (
        <p className="text-xs text-faint">
          {plural(recentOnly ? items.length : (features.data?.meta.total ?? 0), 'feature')}
          {hasFilters && ' matching'}
        </p>
      )}

      {creating && <NewFeatureDialog projectId={projectId} onClose={() => setCreating(false)} />}

      {sharing && project.data && (
        <ShareDialog
          projectId={projectId}
          projectName={project.data.name}
          canManage={canManage(role)}
          onClose={() => setSharing(false)}
          onLeft={() => navigate({ name: 'projects' })}
        />
      )}
      {publishing && (
        <PublishDialog
          projectId={projectId}
          onClose={() => setPublishing(false)}
          onPublished={() => navigate({ name: 'project', projectId })}
        />
      )}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number | string; tone?: 'success' }) {
  return (
    <Card>
      <CardBody className="px-3 py-2.5">
        <p className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</p>
        <p
          className={cn('mt-0.5 text-lg font-semibold tabular-nums', tone === 'success' ? 'text-success' : 'text-ink')}
        >
          {value}
        </p>
      </CardBody>
    </Card>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors',
        active
          ? 'border-accent bg-accent-soft font-medium text-accent'
          : 'border-border text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** Indent per level, in pixels. */
const INDENT = 20

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Room at the left of every row before the tree starts: the colour circles sit
 * here, in one column whatever a feature's level.
 */
const LEAD = 40

/** Room for the drag handle at the start of each row while arranging. */
const ARRANGE_GUTTER = 28

/** The node with this feature id, anywhere in the tree. */
function findNode(nodes: TreeNode[], id: number): TreeNode | undefined {
  for (const node of nodes) {
    if (node.feature.id === id) return node
    const inside = findNode(node.children, id)
    if (inside) return inside
  }
  return undefined
}

function FeatureRow({
  node,
  arranging,
  onGrab,
  moving,
  open,
  canToggle,
  onToggle,
  onOpen,
  adding,
  onAddInside,
  onColor,
  change,
}: {
  node: TreeNode
  /** New or changed since your last visit. */
  change?: 'new' | 'changed'
  /** Arrange mode: a handle to drag by, and the row no longer opens the feature. */
  arranging: boolean
  onGrab: (event: ReactPointerEvent) => void
  /** This row is being dragged, or is inside the one that is. */
  moving: boolean
  open: boolean
  canToggle: boolean
  onToggle: () => void
  onOpen: () => void
  /** The quick-add box under this row is open. */
  adding: boolean
  /** Missing when the person cannot edit, or while filters are on. */
  onAddInside?: () => void
  /** Missing when the person cannot edit: the colour then only shows. */
  onColor?: (color: string) => void
}) {
  const { feature, depth, children, context, parts } = node
  const tasks = feature.tasks
  const gutter = arranging ? ARRANGE_GUTTER : 0

  return (
    <div
      data-row-id={feature.id}
      data-depth={depth}
      data-parent={depth > 0 && feature.parent_feature_id != null ? feature.parent_feature_id : ''}
      className={cn(
        'group/row relative flex items-center transition-colors hover:bg-raised',
        context && 'opacity-50',
        moving && 'opacity-30',
      )}
    >
      {arranging && (
        <button
          type="button"
          onPointerDown={onGrab}
          aria-label={`Drag ${feature.title}`}
          title="Drag to move"
          className="absolute inset-y-0 left-1 z-10 grid w-7 cursor-grab touch-none place-items-center text-faint hover:text-accent active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      <div className="absolute top-1/2 z-10 -translate-y-1/2" style={{ left: gutter + 8 }}>
        <ColorDot color={feature.color} title={feature.title} onChange={onColor} quiet />
      </div>

      {/* One guide line per level above this one. */}
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: gutter + LEAD + 9 + i * INDENT }}
        />
      ))}

      <div className="flex shrink-0 items-center self-stretch" style={{ paddingLeft: gutter + LEAD + depth * INDENT }}>
        {children.length > 0 ? (
          // The click area spans the full row height and 8px either side of the
          // arrow, so a near-miss toggles instead of opening the feature.
          <button
            onClick={onToggle}
            disabled={!canToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} the parts of ${feature.title}`}
            className="group relative z-10 -mx-2 grid h-full place-items-center px-2 text-faint hover:text-ink disabled:pointer-events-none"
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded group-hover:bg-border">
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
            </span>
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
      </div>

      {/* The whole row opens the feature. It is a div, not a button, so the
          "+" after the title can be a button of its own; the title is the
          button that keyboard users reach, and its click bubbles up here. */}
      <div
        onClick={arranging ? undefined : onOpen}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-4 py-3 pl-2 pr-4 text-left',
          !arranging && 'cursor-pointer',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint"
              title={`Level ${depth}`}
            >
              L{depth}
            </span>
            <button
              type="button"
              className="truncate rounded-sm text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {feature.title}
            </button>
            {change && (
              <Badge
                tone={change === 'new' ? 'success' : 'warning'}
                className="shrink-0"
                title={change === 'new' ? 'Added since your last visit' : 'Changed since your last visit'}
              >
                {change === 'new' ? 'New' : 'Changed'}
              </Badge>
            )}
            {parts.total > 0 && (
              <span
                className={cn(
                  'shrink-0 text-2xs tabular-nums',
                  parts.done === parts.total ? 'text-success' : 'text-faint',
                )}
                title={`${parts.done} of ${plural(parts.total, 'part')} done`}
              >
                {parts.done}/{parts.total} done
              </span>
            )}
            {onAddInside && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddInside()
                }}
                title={`Add a feature inside ${feature.title} (L${depth + 1})`}
                aria-label={`Add a feature inside ${feature.title}`}
                aria-expanded={adding}
                // Always shown on touch screens, which have no hover; with a
                // mouse it appears when the row is hovered, so the list stays quiet.
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-md border transition [@media(hover:hover)]:h-6 [@media(hover:hover)]:w-6',
                  adding
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-muted hover:border-accent hover:text-accent [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100',
                )}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Categories are not shown in the list for now: the tree already
                groups features, and the label sat apart from the name. */}
          </div>
          {feature.description && <p className="mt-0.5 truncate text-xs text-muted">{feature.description}</p>}
          {feature.tags.length > 0 && (
            <div className="mt-1.5">
              <TagList tags={feature.tags} />
            </div>
          )}
        </div>

        <div className="hidden w-28 shrink-0 sm:block">
          <StatusPill status={feature.status} />
        </div>

        <div className="hidden w-24 shrink-0 lg:block">
          <PriorityPill priority={feature.priority} />
        </div>

        <div className="w-28 shrink-0 text-right">
          {tasks && tasks.total > 0 ? (
            <>
              <p className="text-xs tabular-nums text-muted">
                {tasks.completed}/{tasks.total} tasks
              </p>
              <Progress
                className="mt-1"
                value={tasks.completed}
                total={tasks.total}
                tone={tasks.completed === tasks.total ? 'success' : 'accent'}
                label={`${feature.title} task completion`}
              />
            </>
          ) : (
            <p className="text-xs text-faint">No tasks</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * An inline box for adding features by name, one level below the row above
 * it. Enter adds and keeps the box open for the next name; Escape, or leaving
 * it empty, closes it.
 */
function QuickAddRow({
  depth,
  placeholder,
  onAdd,
  onClose,
}: {
  depth: number
  placeholder: string
  onAdd: (title: string) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function submit() {
    const name = title.trim()
    if (!name) {
      onClose()
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd(name)
      setTitle('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the feature')
    } finally {
      setSaving(false)
      // The input was disabled while saving, so focus goes back for the next name.
      setTimeout(() => input.current?.focus(), 0)
    }
  }

  return (
    <div className="relative flex items-center bg-accent-soft/40 py-2 pr-4">
      {/* The same guide lines as the rows, so the box sits in the outline. */}
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: 16 + 9 + i * INDENT }} />
      ))}
      <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: LEAD + depth * INDENT + 18 + 8 }}>
        <span className="shrink-0 rounded border border-accent/50 px-1 font-mono text-2xs text-accent">L{depth}</span>
        <input
          ref={input}
          autoFocus
          value={title}
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
          onBlur={() => {
            if (!title.trim() && !saving) onClose()
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 min-w-0 flex-1 rounded-md border border-accent/60 bg-bg px-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />}
      </div>
      <span className="ml-3 hidden shrink-0 text-2xs sm:block">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <span className="text-faint">Enter adds · Esc closes</span>
        )}
      </span>
    </div>
  )
}

/** Saves the list as FEATURES.md: every feature with its description and notes. */
function DownloadFileButton({ projectId }: { projectId: number }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')

  async function download() {
    setState('busy')
    try {
      await downloadFeatureFile(projectId)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn('h-7', state === 'failed' && 'text-danger')}
      onClick={download}
      disabled={state === 'busy'}
      title={
        state === 'failed' ? 'Download failed. Click to try again.' : `Save the feature list as ${FEATURE_FILE_NAME}`
      }
    >
      {state === 'busy' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
      {state === 'failed' ? 'Download failed' : 'Download'}
    </Button>
  )
}

/**
 * Fetches everything on screen again now, for when someone else has just made
 * a change and waiting for the next automatic check is too slow.
 */
function RefreshButton() {
  const queryClient = useQueryClient()
  const fetching = useIsFetching() > 0

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => queryClient.refetchQueries({ type: 'active' })}
      disabled={fetching}
      title="Load the latest changes from everyone now"
    >
      <RefreshCw className={cn('h-3.5 w-3.5', fetching && 'animate-spin')} />
      Refresh
    </Button>
  )
}
