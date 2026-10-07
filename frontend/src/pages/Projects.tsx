import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronLeft, ChevronRight, FolderKanban } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ROLE_LABEL, type Project } from '@/lib/types'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { percent, plural } from '@/lib/utils'

/**
 * The projects list, exercising the paginated shape of the API: search and
 * page state live in the URL-free component state for now, and each change
 * refetches through React Query's cache rather than refetching blindly.
 */
export function Projects({
  search,
  onOpenProject,
}: {
  search: string
  onOpenProject: (id: number) => void
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [page, setPage] = useState(1)
  // An admin can switch between their own projects and every project on the
  // server. Everyone else only ever has their own and those shared with them.
  const [all, setAll] = useState(false)
  const showAll = isAdmin && all

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['projects', { page, search, all: showAll }],
    queryFn: () =>
      api.list<Project>('/projects', {
        query: { page, per_page: 12, q: search, ...(showAll ? { all: 'true' } : {}) },
      }),
    // Keeping the previous page visible while the next loads avoids the list
    // collapsing to a spinner on every page change.
    placeholderData: (previous) => previous,
  })

  const projects = data?.items ?? []
  const meta = data?.meta

  const scopeSwitch = isAdmin && (
    <div className="flex items-center gap-2">
      <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Which projects">
        {[
          { value: false, label: 'My projects' },
          { value: true, label: 'All projects' },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              setAll(option.value)
              setPage(1)
            }}
            aria-pressed={all === option.value}
            className={cn(
              'rounded px-2.5 py-1 text-xs transition-colors',
              all === option.value ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-raised hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {showAll && <span className="text-2xs text-faint">Admin view: every project on this server.</span>}
    </div>
  )

  if (error) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {error instanceof api.ApiError ? error.message : 'Could not load projects'}
          </span>
        </CardBody>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-1.5 w-full" />
            </CardBody>
          </Card>
        ))}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-4">
      {scopeSwitch}
      <Card>
        <CardBody className="py-14 text-center">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
            <FolderKanban className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-ink">
            {search ? `No projects match “${search}”` : 'No projects yet'}
          </p>
          {search && <p className="mt-1 text-xs text-muted">Try a different search term.</p>}
        </CardBody>
      </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {scopeSwitch}
      <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      </div>

      {meta && meta.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            Page {meta.page} of {meta.total_pages} · {plural(meta.total, 'project')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const stats = project.stats
  const features = stats?.feature_count ?? 0
  const done = stats?.completed_features ?? 0
  const stack = typeof project.config?.tech_stack === 'string' ? project.config.tech_stack : null

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="cursor-pointer transition-colors hover:border-accent/40"
    >
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-medium text-ink">{project.name}</h3>
          {stack && stack !== 'Other' && <Badge tone="accent">{stack}</Badge>}
          {project.my_role === 'admin' ? (
            <Badge tone="warning" title="You are opening this as the server's admin">
              Admin
            </Badge>
          ) : (
            project.my_role &&
            project.my_role !== 'owner' && (
              <Badge tone="neutral" title={`Shared with you as ${ROLE_LABEL[project.my_role].toLowerCase()}`}>
                Shared · {ROLE_LABEL[project.my_role]}
              </Badge>
            )
          )}
        </div>

        <p className="line-clamp-2 min-h-[2rem] text-xs text-muted">
          {project.description || 'No description'}
        </p>

        <div>
          <div className="mb-1.5 flex justify-between text-2xs text-faint">
            <span>{features > 0 ? `${done}/${features} features` : 'No features'}</span>
            <span className="tabular-nums">{percent(done, features)}%</span>
          </div>
          <Progress value={done} total={features} label={`${project.name} completion`} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2.5 text-2xs text-faint">
          <span>{plural(stats?.task_count ?? 0, 'task')}</span>
          {project.owner ? <span>{project.owner.username}</span> : <span>Unassigned</span>}
        </div>
      </CardBody>
    </Card>
  )
}
