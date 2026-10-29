import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, Bell, Pencil, Plus } from 'lucide-react'
import { useMarkSpaceSeen, useMyCopies, useSpace, type MyCopy, type SpacePublish } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, plural } from '@/lib/utils'
import { ROLE_LABEL } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * My Space › Dashboard: what you are working on.
 *
 * Your latest copy to carry on with, what was published in your projects since
 * you last looked, and each project you are on with where it stands. Looking
 * marks it seen, so the next visit only lists what is newer.
 */
export function MySpaceDashboard() {
  const { navigate } = useRouter()
  const space = useSpace()
  const markSeen = useMarkSpaceSeen()
  const marked = useRef(false)

  // Fresh from the server on this visit, not what an earlier visit left in the
  // cache: that one's "new" was already seen.
  const fresh = space.isFetchedAfterMount && space.isSuccess

  // Mark the visit seen once this visit's list has arrived, so a reload right
  // away doesn't lose it before it was read.
  useEffect(() => {
    if (fresh && !marked.current) {
      marked.current = true
      markSeen.mutate()
    }
  }, [fresh, markSeen])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">My Space</h2>
        <p className="mt-0.5 text-sm text-muted">What you are working on, and what changed in your projects.</p>
      </div>

      <ContinueCard />

      {space.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : space.isError || !space.data ? (
        <Card>
          <CardBody className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            Could not load your projects.
            <Button variant="secondary" size="sm" onClick={() => space.refetch()}>
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            {fresh ? (
              <NewSince key={space.data.seen_at ?? 'first'} seenAt={space.data.seen_at} items={space.data.new} />
            ) : (
              <Skeleton className="h-28 w-full" />
            )}
          </div>
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>My projects</CardTitle>
            </CardHeader>
            {space.data.projects.length === 0 ? (
              <CardBody className="text-sm text-muted">You are not on any project yet.</CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {space.data.projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ name: 'projectDashboard', projectId: p.id })}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-raised"
                    >
                      <span className="min-w-0 flex-1 basis-48">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                          <Badge>{ROLE_LABEL[p.role]}</Badge>
                        </span>
                        <span className="block text-xs text-muted">
                          {p.latest
                            ? `Published #${p.latest.publish_number} · ${when(p.latest.at)}`
                            : 'Nothing published yet'}
                        </span>
                      </span>
                      {p.latest && p.unpublished > 0 && (
                        <Badge tone="warning" title="Changes in the Working list since the latest publish">
                          {plural(p.unpublished, 'unpublished change')}
                        </Badge>
                      )}
                      <span className="w-32 shrink-0">
                        <span className="mb-1 block text-right text-2xs tabular-nums text-muted">
                          {p.done}/{p.features} done
                        </span>
                        <Progress
                          value={p.done}
                          total={p.features}
                          tone={p.features > 0 && p.done === p.features ? 'success' : 'accent'}
                          label={`${p.name} progress`}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/** Your latest copy to carry on with, and the next few. */
function ContinueCard() {
  const { navigate } = useRouter()
  const copies = useMyCopies()
  const editable = (copies.data ?? []).filter((c) => !c.published_at && !c.merged_at)
  const [latest, ...rest] = editable
  const open = (c: MyCopy) => navigate({ name: 'myCopy', copyProjectId: c.project_id, copyId: c.id })

  if (copies.isLoading) return <Skeleton className="h-24 w-full" />

  return (
    <Card className={cn(latest && 'border-accent/50')}>
      <CardBody className="flex flex-wrap items-center gap-4">
        {latest ? (
          <>
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-2xs font-semibold uppercase tracking-wider text-faint">Continue where you left off</p>
              <p className="mt-1 truncate text-sm font-medium text-ink">{latest.name || `Copy ${latest.number}`}</p>
              <p className="text-xs text-muted">
                {latest.project.name} · {plural(latest.feature_count, 'feature')} · edited {when(latest.updated_at)}
              </p>
              {rest.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {rest.slice(0, 3).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => open(c)}
                      className="rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-ink"
                    >
                      {c.name || `Copy ${c.number}`} · {c.project.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" onClick={() => open(latest)}>
              <Pencil className="h-3.5 w-3.5" />
              Open
            </Button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">No copy to work on yet</p>
              <p className="text-xs text-muted">Pull a project's Published or Working list into My Space to rework it.</p>
            </div>
            <Button size="sm" onClick={() => navigate({ name: 'myWorking' })}>
              <Plus className="h-3.5 w-3.5" />
              Start a copy
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  )
}

/** Publishes by others in your projects since your last visit. */
function NewSince({ seenAt, items }: { seenAt: string | null; items: SpacePublish[] }) {
  const { navigate } = useRouter()
  // Kept as first loaded: the visit is marked seen straight after.
  const [shown] = useState(items)

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-faint" />
        <CardTitle>New since you last looked</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {seenAt === null ? (
          <p className="px-4 py-4 text-sm text-muted">
            From your next visit, publishes in your projects since this one will show here.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">Nothing new since {when(seenAt)}.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((p) => (
              <li key={p.version_id}>
                <button
                  type="button"
                  onClick={() => navigate({ name: 'project', projectId: p.project_id })}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-raised"
                >
                  <Badge tone="accent" className="shrink-0 font-mono">
                    #{p.publish_number}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {p.project_name}
                      {p.notes && <span className="text-muted"> · “{p.notes}”</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      {p.by || 'someone since removed'} · {when(p.at)}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
