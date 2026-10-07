import { useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, Plus, Rocket, X } from 'lucide-react'
import { useProject, useReleases } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { NewReleaseDialog } from './NewReleaseDialog'
import { GitHubPanel } from './GitHubPanel'
import { cn, plural } from '@/lib/utils'
import { RELEASE_STATUS_LABEL, canManage, type Release, type ReleaseStatus } from '@/lib/types'

// All four statuses that occur, not just the two this screen creates: the
// older Git finalize flow leaves releases as "failed" and "in_progress", and a
// filter row that cannot reach them hides rows the list is showing.
const STATUSES: ReleaseStatus[] = ['draft', 'published', 'in_progress', 'failed']

/**
 * A project's releases.
 *
 * A release is a plan with two halves — the features going into it and the
 * pull requests delivering them — so each row shows both, and the reader can
 * see at a glance which release is waiting on what.
 */
export function Releases({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()

  const [statuses, setStatuses] = useState<ReleaseStatus[]>([])
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const filters = useMemo(() => ({ status: statuses, q: search }), [statuses, search])

  const project = useProject(projectId)
  const releases = useReleases(projectId, filters)

  const hasFilters = statuses.length > 0 || search !== ''
  const items = releases.data?.items ?? []

  function toggleStatus(status: ReleaseStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    )
  }

  function clearFilters() {
    setStatuses([])
    setSearch('')
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-8 w-8 shrink-0 p-0"
          onClick={() => navigate({ name: 'project', projectId })}
          aria-label="Back to the project"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          {project.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <>
              <h2 className="truncate text-base font-semibold text-ink">Releases</h2>
              <p className="mt-0.5 text-sm text-muted">{project.data?.name}</p>
            </>
          )}
        </div>

        <Button size="sm" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          Plan a release
        </Button>
      </div>

      <GitHubPanel
        projectId={projectId}
        canEdit={!!project.data && project.data.my_role !== 'viewer'}
        canLink={canManage(project.data?.my_role)}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex gap-1">
            {STATUSES.map((status) => (
              <FilterChip
                key={status}
                active={statuses.includes(status)}
                onClick={() => toggleStatus(status)}
              >
                {RELEASE_STATUS_LABEL[status]}
              </FilterChip>
            ))}
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter releases…"
            aria-label="Filter releases"
            className="ml-auto h-7 w-48 rounded-md border border-border bg-bg px-2.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7" onClick={clearFilters}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        <CardBody className="p-0">
          {releases.isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : releases.isError ? (
            <div className="px-4 py-12 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-soft text-danger">
                <AlertCircle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">Could not load releases</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                {releases.error instanceof ApiError
                  ? releases.error.message
                  : 'The server could not be reached.'}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => releases.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
                <Rocket className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">
                {hasFilters ? 'No releases match these filters' : 'No releases yet'}
              </p>
              {hasFilters ? (
                <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
                    A release gathers the features and pull requests that go out together.
                  </p>
                  <Button size="sm" className="mt-3" onClick={() => setCreating(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Plan the first release
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div
              className={cn(
                'divide-y divide-border transition-opacity',
                releases.isFetching && 'opacity-60',
              )}
            >
              {items.map((release) => (
                <ReleaseRow
                  key={release.id}
                  release={release}
                  onOpen={() => navigate({ name: 'release', projectId, releaseId: release.id })}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && (
        <p className="text-xs text-faint">
          {plural(releases.data?.meta.total ?? 0, 'release')}
          {hasFilters && ' matching'}
        </p>
      )}

      {creating && (
        <NewReleaseDialog
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(releaseId) => {
            setCreating(false)
            navigate({ name: 'release', projectId, releaseId })
          }}
        />
      )}
    </div>
  )
}

/** The status badge, defined once so the list and the detail page agree. */
export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const tone =
    status === 'published'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'in_progress'
          ? 'warning'
          : 'neutral'
  return <Badge tone={tone}>{RELEASE_STATUS_LABEL[status] ?? status}</Badge>
}

function ReleaseRow({ release, onOpen }: { release: Release; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-raised"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-medium text-ink">{release.tag}</span>
          <ReleaseStatusBadge status={release.status} />
        </div>
        {release.notes && (
          <p className="mt-0.5 truncate text-xs text-muted">{release.notes}</p>
        )}
      </div>

      <CountColumn label="features" counts={release.features} />
      <CountColumn label="pull requests" counts={release.pull_requests} />
    </button>
  )
}

function CountColumn({
  label,
  counts,
}: {
  label: string
  counts: { total: number; done: number }
}) {
  if (counts.total === 0) {
    return (
      <div className="hidden w-32 shrink-0 text-right sm:block">
        <p className="text-xs text-faint">No {label}</p>
      </div>
    )
  }

  return (
    <div className="hidden w-32 shrink-0 text-right sm:block">
      <p className="text-xs tabular-nums text-muted">
        {counts.done}/{counts.total} {label}
      </p>
      <Progress
        className="mt-1"
        value={counts.done}
        total={counts.total}
        tone={counts.done === counts.total ? 'success' : 'accent'}
        label={`${label} ready`}
      />
    </div>
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
