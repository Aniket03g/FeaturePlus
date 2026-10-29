import { useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, Clock, GitCompare, Pencil, Send, Users } from 'lucide-react'
import {
  useDependencyGraph,
  useFeatures,
  useMembers,
  useProject,
  usePublished,
  useVersionComparison,
  useVersions,
} from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/FeatureBits'
import { PublishDialog } from './PublishDialog'
import { cn, percent, plural } from '@/lib/utils'
import { ROLE_LABEL, type Feature } from '@/lib/types'

/** No filters: the same key the project's feature lists use, so all share one request. */
const ALL_FEATURES = { status: [], tag: '', q: '' }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Project › Dashboard: where a project stands and what has changed.
 *
 * The plan's state first (what is published, what the working list holds that
 * isn't yet), then progress overall and by top-level area, the features held
 * up by unfinished dependencies, recent activity, and who is on the project.
 * Progress is read from the working list, since that is where status moves.
 */
export function ProjectDashboard({ projectId }: { projectId: number }) {
  const project = useProject(projectId)
  const features = useFeatures(projectId, ALL_FEATURES)

  if (project.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {project.error instanceof ApiError ? project.error.message : 'Could not load the project'}
          </span>
        </CardBody>
      </Card>
    )
  }

  const items = features.data?.items ?? []
  const canEdit = project.data?.my_role !== undefined && project.data.my_role !== 'viewer'

  return (
    <div className="space-y-4">
      <div>
        {project.isLoading ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <>
            <h2 className="text-base font-semibold text-ink">{project.data?.name}</h2>
            {project.data?.description && <p className="mt-0.5 text-sm text-muted">{project.data.description}</p>}
          </>
        )}
      </div>

      <PlanStatus projectId={projectId} canEdit={canEdit} />

      {features.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <ProgressTiles items={items} tasks={project.data?.stats} />
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <ByArea projectId={projectId} items={items} loading={features.isLoading} />
          <Waiting projectId={projectId} />
        </div>
        <div className="space-y-4">
          <RecentActivity projectId={projectId} items={items} />
          <TeamCard projectId={projectId} ownerName={project.data?.owner?.name || project.data?.owner?.username} />
        </div>
      </div>
    </div>
  )
}

/** What is published, and what the working list holds that isn't yet. */
function PlanStatus({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const { navigate } = useRouter()
  const published = usePublished(projectId)
  const latest = published.data ?? null
  const since = useVersionComparison(projectId, latest ? latest.id : null, latest ? 'current' : null)
  const [publishing, setPublishing] = useState(false)

  const changes = since.data ? since.data.added + since.data.removed + since.data.changed : 0

  return (
    <Card className={cn(changes > 0 && 'border-accent/50')}>
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-faint">Published</p>
          {published.isLoading ? (
            <Skeleton className="mt-1.5 h-5 w-48" />
          ) : latest ? (
            <>
              <button
                type="button"
                className="mt-1 text-left text-sm font-medium text-ink hover:underline"
                onClick={() => navigate({ name: 'project', projectId })}
              >
                Published #{latest.publish_number}
                {latest.notes && <span className="font-normal text-muted"> · “{latest.notes}”</span>}
              </button>
              <p className="text-xs text-muted">
                {when(latest.published_at ?? latest.created_at)} by {latest.saved_by.name || 'someone since removed'} ·{' '}
                {plural(latest.feature_count, 'feature')}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Nothing published yet.</p>
          )}
        </div>

        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-faint">Working</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            {!latest ? (
              <span className="text-muted">Everything in the Working list is unpublished.</span>
            ) : since.isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : changes === 0 ? (
              <span className="text-muted">No changes since Published #{latest.publish_number}.</span>
            ) : (
              <>
                <span className="font-medium text-ink">{plural(changes, 'change')} not yet published</span>
                {since.data!.added > 0 && <Badge tone="success">+{since.data!.added}</Badge>}
                {since.data!.removed > 0 && <Badge tone="danger">−{since.data!.removed}</Badge>}
                {since.data!.changed > 0 && <Badge tone="warning">{since.data!.changed} changed</Badge>}
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {latest && changes > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate({ name: 'compare', projectId, from: String(latest.id), to: 'current' })}
              >
                <GitCompare className="h-3.5 w-3.5" />
                See changes
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'inProgress', projectId })}>
              <Pencil className="h-3.5 w-3.5" />
              Open Working
            </Button>
            {canEdit && (!latest || changes > 0) && (
              <Button size="sm" onClick={() => setPublishing(true)}>
                <Send className="h-3.5 w-3.5" />
                Publish{latest ? ` as #${latest.publish_number + 1}` : ''}
              </Button>
            )}
          </div>
        </div>
      </CardBody>
      {publishing && (
        <PublishDialog projectId={projectId} onClose={() => setPublishing(false)} onPublished={() => setPublishing(false)} />
      )}
    </Card>
  )
}

function ProgressTiles({
  items,
  tasks,
}: {
  items: Feature[]
  tasks?: { task_count: number; completed_tasks: number }
}) {
  const done = items.filter((f) => f.status === 'done').length
  const doing = items.filter((f) => f.status === 'in_progress').length
  const todo = items.length - done - doing

  const tile = (label: string, value: string, sub?: string, tone?: string) => (
    <Card>
      <CardBody className="px-3 py-2.5">
        <p className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</p>
        <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', tone ?? 'text-ink')}>{value}</p>
        {sub && <p className="text-2xs text-faint">{sub}</p>}
      </CardBody>
    </Card>
  )

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tile('Done', `${done} / ${items.length}`, `${percent(done, items.length)}% of features`, 'text-success')}
      {tile('In progress', String(doing), 'features')}
      {tile('To do', String(todo), 'features')}
      {tile(
        'Tasks done',
        tasks ? `${tasks.completed_tasks} / ${tasks.task_count}` : '—',
        tasks && tasks.task_count > 0 ? `${percent(tasks.completed_tasks, tasks.task_count)}%` : 'no tasks yet',
      )}
    </div>
  )
}

/** One bar per top-level feature: how much of what sits inside it is done. */
function ByArea({ projectId, items, loading }: { projectId: number; items: Feature[]; loading: boolean }) {
  const { navigate } = useRouter()

  const areas = useMemo(() => {
    const children = new Map<number, Feature[]>()
    for (const f of items) {
      if (f.parent_feature_id) children.set(f.parent_feature_id, [...(children.get(f.parent_feature_id) ?? []), f])
    }
    const inside = (id: number): Feature[] =>
      (children.get(id) ?? []).flatMap((child) => [child, ...inside(child.id)])
    return items
      .filter((f) => !f.parent_feature_id)
      .map((top) => {
        const all = inside(top.id)
        // A top-level feature with nothing inside counts as its own one piece of work.
        const counted = all.length > 0 ? all : [top]
        return { top, total: counted.length, done: counted.filter((f) => f.status === 'done').length }
      })
  }, [items])

  return (
    <Card>
      <CardHeader>
        <CardTitle>By area</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : areas.length === 0 ? (
          <p className="text-sm text-muted">No features yet.</p>
        ) : (
          areas.map(({ top, total, done }) => (
            <button
              key={top.id}
              type="button"
              onClick={() => navigate({ name: 'feature', projectId, featureId: top.id, editable: true })}
              className="block w-full rounded-md text-left hover:bg-raised/60"
            >
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-ink">{top.title}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', done === total ? 'text-success' : 'text-muted')}>
                  {done}/{total}
                </span>
              </div>
              <Progress value={done} total={total} tone={done === total ? 'success' : 'accent'} label={`${top.title} progress`} />
            </button>
          ))
        )}
      </CardBody>
    </Card>
  )
}

/** Features not done that depend on something not done yet. */
function Waiting({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const graph = useDependencyGraph(projectId)

  const waiting = useMemo(() => {
    const nodes = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n]))
    const blockers = new Map<number, string[]>()
    for (const edge of graph.data?.edges ?? []) {
      // child_id needs parent_id finished first.
      const needed = nodes.get(edge.parent_id)
      const waiter = nodes.get(edge.child_id)
      if (!needed || !waiter || waiter.status === 'done' || needed.status === 'done') continue
      blockers.set(waiter.id, [...(blockers.get(waiter.id) ?? []), needed.title])
    }
    return [...blockers.entries()].map(([id, on]) => ({ node: nodes.get(id)!, on }))
  }, [graph.data])

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Waiting on others</CardTitle>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => navigate({ name: 'dependencies', projectId })}>
          Dependency map
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardBody className="p-0">
        {graph.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : waiting.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">Nothing is held up by an unfinished dependency.</p>
        ) : (
          <ul className="divide-y divide-border">
            {waiting.slice(0, 8).map(({ node, on }) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => navigate({ name: 'feature', projectId, featureId: node.id, editable: true })}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-raised"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{node.title}</span>
                    <span className="block truncate text-xs text-muted">waits for {on.join(', ')}</span>
                  </span>
                  <StatusPill status={node.status} />
                </button>
              </li>
            ))}
            {waiting.length > 8 && (
              <li className="px-4 py-2 text-xs text-muted">and {waiting.length - 8} more on the dependency map</li>
            )}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** The last few publishes, and the features changed most recently. */
function RecentActivity({ projectId, items }: { projectId: number; items: Feature[] }) {
  const { navigate } = useRouter()
  const versions = useVersions(projectId)
  const publishes = (versions.data ?? []).filter((v) => v.publish_number > 0).slice(0, 3)
  const changed = useMemo(
    () => [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5),
    [items],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <section>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Publishes</h3>
          {publishes.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {publishes.map((v) => (
                <li key={v.id} className="flex items-baseline gap-2 text-sm">
                  <Badge tone="accent" className="shrink-0 font-mono">
                    #{v.publish_number}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-ink">{v.notes || v.tag}</span>
                  <span className="shrink-0 text-xs text-faint">{when(v.published_at ?? v.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Recently changed</h3>
          {changed.length === 0 ? (
            <p className="text-sm text-muted">No features yet.</p>
          ) : (
            <ul className="space-y-1">
              {changed.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'feature', projectId, featureId: f.id, editable: true })}
                    className="flex w-full items-baseline gap-2 rounded text-left text-sm hover:underline"
                  >
                    <span className="min-w-0 flex-1 truncate text-ink">{f.title}</span>
                    <span className="shrink-0 text-xs text-faint">{when(f.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardBody>
    </Card>
  )
}

/** Who is on the project and as what. */
function TeamCard({ projectId, ownerName }: { projectId: number; ownerName?: string }) {
  const members = useMembers(projectId)
  const list = members.data?.items ?? []

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <Users className="h-4 w-4 text-faint" />
        <CardTitle>Team</CardTitle>
      </CardHeader>
      <CardBody>
        {members.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <ul className="space-y-1.5">
            {ownerName && !list.some((m) => m.role === 'owner') && (
              <li className="flex items-center justify-between text-sm">
                <span className="text-ink">{ownerName}</span>
                <Badge>{ROLE_LABEL.owner}</Badge>
              </li>
            )}
            {list.map((m) => (
              <li key={m.user.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-ink">{m.user.name || m.user.username}</span>
                <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
              </li>
            ))}
            {list.length === 0 && !ownerName && <li className="text-sm text-muted">Nobody yet.</li>}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
