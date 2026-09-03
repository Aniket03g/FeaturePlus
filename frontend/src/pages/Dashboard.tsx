import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban, ListChecks, CheckCircle2, Layers, AlertCircle } from 'lucide-react'
import * as api from '@/lib/api'
import type { Project } from '@/lib/types'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { plural, percent } from '@/lib/utils'

/**
 * The dashboard: totals across every project, then the projects themselves
 * ordered by how much work they still hold.
 *
 * All of it comes from one request. The API returns per-project stats with the
 * list, so the page does not fan out into a request per project.
 */
export function Dashboard({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects', { perPage: 200 }],
    queryFn: () => api.list<Project>('/projects', { query: { per_page: 200 } }),
  })

  const projects = data?.items ?? []

  const totals = useMemo(() => {
    return projects.reduce(
      (acc, p) => ({
        features: acc.features + (p.stats?.feature_count ?? 0),
        completedFeatures: acc.completedFeatures + (p.stats?.completed_features ?? 0),
        tasks: acc.tasks + (p.stats?.task_count ?? 0),
        completedTasks: acc.completedTasks + (p.stats?.completed_tasks ?? 0),
      }),
      { features: 0, completedFeatures: 0, tasks: 0, completedTasks: 0 },
    )
  }, [projects])

  // Projects with the most outstanding features first: the dashboard should
  // lead with where the work is, not with whichever row the database returned
  // first.
  const ranked = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const remaining = (p: Project) =>
          (p.stats?.feature_count ?? 0) - (p.stats?.completed_features ?? 0)
        return remaining(b) - remaining(a)
      }),
    [projects],
  )

  if (error) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-ink">Could not load projects</p>
            <p className="text-xs text-muted">
              {error instanceof api.ApiError ? error.message : 'An unexpected error occurred'}
            </p>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Projects"
          value={projects.length}
          icon={FolderKanban}
          loading={isLoading}
        />
        <StatTile
          label="Features"
          value={totals.features}
          detail={`${totals.completedFeatures} done`}
          icon={Layers}
          loading={isLoading}
        />
        <StatTile
          label="Tasks"
          value={totals.tasks}
          detail={`${totals.completedTasks} done`}
          icon={ListChecks}
          loading={isLoading}
        />
        <StatTile
          label="Completion"
          value={`${percent(totals.completedFeatures, totals.features)}%`}
          detail="of features"
          icon={CheckCircle2}
          loading={isLoading}
        />
      </section>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Projects</CardTitle>
          {!isLoading && (
            <span className="text-2xs text-faint">{plural(projects.length, 'project')}</span>
          )}
        </CardHeader>

        <CardBody className="p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-1.5 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="divide-y divide-border">
              {ranked.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onOpen={() => onOpenProject(project.id)}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  loading,
}: {
  label: string
  value: number | string
  detail?: string
  icon: typeof FolderKanban
  loading?: boolean
}) {
  return (
    <Card>
      <CardBody className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-14" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">
              {value}
            </p>
          )}
          {detail && !loading && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
        </div>
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
          <Icon className="h-4 w-4" />
        </div>
      </CardBody>
    </Card>
  )
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const stats = project.stats
  const features = stats?.feature_count ?? 0
  const done = stats?.completed_features ?? 0
  const pct = percent(done, features)

  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-raised"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{project.name}</span>
          {features > 0 && pct === 100 && <Badge tone="success">complete</Badge>}
        </div>
        {project.description && (
          <p className="mt-0.5 truncate text-xs text-muted">{project.description}</p>
        )}
      </div>

      <div className="hidden w-40 shrink-0 sm:block">
        <div className="mb-1 flex justify-between text-2xs text-faint">
          <span>{features > 0 ? `${done}/${features} features` : 'No features'}</span>
          {features > 0 && <span className="tabular-nums">{pct}%</span>}
        </div>
        <Progress
          value={done}
          total={features}
          tone={pct === 100 ? 'success' : 'accent'}
          label={`${project.name} feature completion`}
        />
      </div>

      <div className="w-24 shrink-0 text-right">
        <p className="text-xs tabular-nums text-muted">
          {plural(stats?.task_count ?? 0, 'task')}
        </p>
        {(stats?.completed_tasks ?? 0) > 0 && (
          <p className="text-2xs tabular-nums text-success">{stats?.completed_tasks} done</p>
        )}
      </div>
    </button>
  )
}

function EmptyState() {
  return (
    <div className="px-4 py-14 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
        <FolderKanban className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-ink">No projects yet</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
        Projects you create or are added to will appear here.
      </p>
    </div>
  )
}
