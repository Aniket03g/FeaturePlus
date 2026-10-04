import { useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, GitPullRequest, X } from 'lucide-react'
import { useProject, usePullRequests } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PullRequestPanel } from './PullRequestPanel'
import { PullRequestState } from './ReleaseDetail'
import { cn, plural } from '@/lib/utils'
import type { PullRequest } from '@/lib/types'

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

/**
 * A project's pull requests, as a queue.
 *
 * The order is deliberate and comes from the API: anything still waiting on a
 * person comes first, and settled work — approved and tested, or turned down —
 * sinks below it. The list is what to do next, not an archive.
 */
export function PullRequests({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()

  const [statuses, setStatuses] = useState<string[]>([])
  const [tested, setTested] = useState<'true' | 'false' | ''>('')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(0)

  const filters = useMemo(
    () => ({ status: statuses, tested, q: search }),
    [statuses, tested, search],
  )

  const project = useProject(projectId)
  const prs = usePullRequests(projectId, filters)

  const hasFilters = statuses.length > 0 || tested !== '' || search !== ''
  const items = prs.data?.items ?? []

  function toggleStatus(key: string) {
    setStatuses((current) =>
      current.includes(key) ? current.filter((s) => s !== key) : [...current, key],
    )
  }

  function clearFilters() {
    setStatuses([])
    setTested('')
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
              <h2 className="truncate text-base font-semibold text-ink">Pull requests</h2>
              <p className="mt-0.5 text-sm text-muted">{project.data?.name}</p>
            </>
          )}
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <FilterChip
                key={filter.key}
                active={statuses.includes(filter.key)}
                onClick={() => toggleStatus(filter.key)}
              >
                {filter.label}
              </FilterChip>
            ))}
          </div>

          <div className="mx-1 h-5 w-px bg-border" />

          <FilterChip
            active={tested === 'false'}
            onClick={() => setTested(tested === 'false' ? '' : 'false')}
          >
            Untested
          </FilterChip>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title or branch…"
            aria-label="Filter pull requests"
            className="ml-auto h-7 w-52 rounded-md border border-border bg-bg px-2.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7" onClick={clearFilters}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        <CardBody className="p-0">
          {prs.isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-4 w-64" />
                </div>
              ))}
            </div>
          ) : prs.isError ? (
            <div className="px-4 py-12 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-soft text-danger">
                <AlertCircle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">Could not load pull requests</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                {prs.error instanceof ApiError
                  ? prs.error.message
                  : 'The server could not be reached.'}
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => prs.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
                <GitPullRequest className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">
                {hasFilters ? 'No pull requests match these filters' : 'No pull requests yet'}
              </p>
              {hasFilters ? (
                <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
                  Pull requests are raised against a task, from the task's own screen.
                </p>
              )}
            </div>
          ) : (
            <div
              className={cn(
                'divide-y divide-border transition-opacity',
                prs.isFetching && 'opacity-60',
              )}
            >
              {items.map((pr) => (
                <PullRequestRow key={pr.id} pr={pr} onOpen={() => setOpenId(pr.id)} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && (
        <p className="text-xs text-faint">
          {plural(prs.data?.meta.total ?? 0, 'pull request')}
          {hasFilters && ' matching'}
        </p>
      )}

      {openId > 0 && (
        <PullRequestPanel
          projectId={projectId}
          pullRequestId={openId}
          onClose={() => setOpenId(0)}
        />
      )}
    </div>
  )
}

function PullRequestRow({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-raised"
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{pr.title}</span>
        <p className="mt-0.5 truncate text-xs text-muted">
          <span className="font-mono">{pr.branch}</span>
          {pr.feature_title && <span className="text-faint"> · {pr.feature_title}</span>}
          {pr.task_name && <span className="text-faint"> · {pr.task_name}</span>}
        </p>
      </div>

      <PullRequestState pr={pr} />
    </button>
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
