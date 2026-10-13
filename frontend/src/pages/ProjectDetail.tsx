import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  FileCode,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Network,
  Plus,
  Users,
  X,
} from 'lucide-react'
import { useFeatures, useProject, useProjectTags } from '@/lib/queries'
import { downloadFeatureFile, FEATURE_FILE_NAME } from '@/lib/feature-file'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, PriorityPill, TagList } from '@/components/FeatureBits'
import { NewFeatureDialog } from './NewFeatureDialog'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { ShareDialog } from './ShareDialog'
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
 * A project's features, with filters.
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
  const [applying, setApplying] = useState(false)
  const [sharing, setSharing] = useState(false)

  const filters = useMemo(
    () => ({ status: statuses, tag, q: search }),
    [statuses, tag, search],
  )

  const project = useProject(projectId)
  const features = useFeatures(projectId, filters)
  // The whole list, so a filtered match can still be shown under its parents.
  // With no filters set this is the same query as the one above.
  const allFeatures = useFeatures(projectId, NO_FILTERS)
  const tags = useProjectTags(projectId)

  const hasFilters = statuses.length > 0 || tag !== '' || search !== ''
  const items = features.data?.items ?? []

  // Which parents are open, by feature id. Unset means the default: L0 open,
  // deeper levels closed, so a big project opens on its outline.
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const tree = useMemo(
    () => buildTree(allFeatures.data?.items ?? items, hasFilters ? items : null),
    [allFeatures.data, items, hasFilters],
  )
  const isOpen = (node: TreeNode) =>
    hasFilters || (open[node.feature.id] ?? node.depth === 0)
  const rows = visibleRows(tree, isOpen)
  const hasNesting = tree.some((node) => node.children.length > 0)

  function setAllOpen(value: boolean) {
    const next: Record<number, boolean> = {}
    walk(tree, (node) => {
      if (node.children.length > 0) next[node.feature.id] = value
    })
    setOpen(next)
  }

  function toggleStatus(status: FeatureStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    )
  }

  function clearFilters() {
    setStatuses([])
    setTag('')
    setSearch('')
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
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-8 w-8 shrink-0 p-0"
          onClick={() => navigate({ name: 'projects' })}
          aria-label="Back to projects"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          {project.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-ink">{project.data?.name}</h2>
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
              {project.data?.description && (
                <p className="mt-0.5 text-sm text-muted">{project.data.description}</p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate({ name: 'code', projectId })}
          >
            <FileCode className="h-3.5 w-3.5" />
            Code
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate({ name: 'dependencies', projectId })}
          >
            <Network className="h-3.5 w-3.5" />
            Dependencies
          </Button>
          <DownloadFileButton projectId={projectId} />
          <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
            <Users className="h-3.5 w-3.5" />
            Share
          </Button>
          {canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setApplying(true)}>
                <LayoutTemplate className="h-3.5 w-3.5" />
                Template
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" />
                New feature
              </Button>
            </>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Features" value={stats.feature_count} />
          <MiniStat label="Done" value={stats.completed_features} tone="success" />
          <MiniStat label="Tasks" value={stats.task_count} />
          <MiniStat
            label="Progress"
            value={`${percent(stats.completed_features, stats.feature_count)}%`}
          />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex gap-1">
            {STATUSES.map((status) => (
              <FilterChip
                key={status}
                active={statuses.includes(status)}
                onClick={() => toggleStatus(status)}
              >
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

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter features…"
            aria-label="Filter features"
            className="ml-auto h-7 w-48 rounded-md border border-border bg-bg px-2.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7" onClick={clearFilters}>
              <X className="h-3 w-3" />
              Clear
            </Button>
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
                {features.error instanceof ApiError
                  ? features.error.message
                  : 'The server could not be reached.'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => features.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
                <ListChecks className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">
                {hasFilters ? 'No features match these filters' : 'No features yet'}
              </p>
              {hasFilters ? (
                <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" className="mt-3" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add the first feature
                </Button>
              )}
            </div>
          ) : (
            <div
              className={cn(
                'divide-y divide-border transition-opacity',
                features.isFetching && 'opacity-60',
              )}
            >
              {rows.map((node) => (
                <FeatureRow
                  key={node.feature.id}
                  node={node}
                  open={isOpen(node)}
                  canToggle={!hasFilters}
                  onToggle={() =>
                    setOpen((current) => ({ ...current, [node.feature.id]: !isOpen(node) }))
                  }
                  onOpen={() =>
                    navigate({ name: 'feature', projectId, featureId: node.feature.id })
                  }
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && (
        <p className="text-xs text-faint">
          {plural(features.data?.meta.total ?? 0, 'feature')}
          {hasFilters && ' matching'}
        </p>
      )}

      {creating && (
        <NewFeatureDialog projectId={projectId} onClose={() => setCreating(false)} />
      )}

      {applying && (
        <ApplyTemplateDialog projectId={projectId} onClose={() => setApplying(false)} />
      )}

      {sharing && project.data && (
        <ShareDialog
          projectId={projectId}
          projectName={project.data.name}
          canManage={canManage(role)}
          onClose={() => setSharing(false)}
          onLeft={() => navigate({ name: 'projects' })}
        />
      )}
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'success'
}) {
  return (
    <Card>
      <CardBody className="px-3 py-2.5">
        <p className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</p>
        <p
          className={cn(
            'mt-0.5 text-lg font-semibold tabular-nums',
            tone === 'success' ? 'text-success' : 'text-ink',
          )}
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

function FeatureRow({
  node,
  open,
  canToggle,
  onToggle,
  onOpen,
}: {
  node: TreeNode
  open: boolean
  canToggle: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const { feature, depth, children, context, parts } = node
  const tasks = feature.tasks

  return (
    <div
      className={cn(
        'relative flex items-center transition-colors hover:bg-raised',
        context && 'opacity-50',
      )}
    >
      {/* One guide line per level above this one. */}
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: 16 + 9 + i * INDENT }}
        />
      ))}

      <div
        className="flex shrink-0 items-center self-stretch"
        style={{ paddingLeft: 16 + depth * INDENT }}
      >
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

      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-2 pr-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint"
              title={`Level ${depth}`}
            >
              L{depth}
            </span>
            <span className="truncate text-sm font-medium text-ink">{feature.title}</span>
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
            {feature.category && feature.category !== 'general' && (
              <Badge>{feature.category}</Badge>
            )}
          </div>
          {feature.description && (
            <p className="mt-0.5 truncate text-xs text-muted">{feature.description}</p>
          )}
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
      </button>
    </div>
  )
}

/** Saves the project's features as FEATURES.md, ready to commit to the repo. */
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
      onClick={download}
      disabled={state === 'busy'}
      title={state === 'failed' ? 'Download failed. Click to try again.' : `Save the feature list as ${FEATURE_FILE_NAME}`}
      className={cn(state === 'failed' && 'text-danger')}
    >
      {state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {state === 'failed' ? 'Download failed' : 'Download .md'}
    </Button>
  )
}
