import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  FileCode,
  LayoutTemplate,
  ListChecks,
  Network,
  Plus,
  X,
} from 'lucide-react'
import { useFeatures, useProject, useProjectTags } from '@/lib/queries'
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
import { cn, percent, plural } from '@/lib/utils'
import { STATUS_LABEL, type Feature, type FeatureStatus } from '@/lib/types'

const STATUSES: FeatureStatus[] = ['todo', 'in_progress', 'done']

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

  const filters = useMemo(
    () => ({ status: statuses, tag, q: search }),
    [statuses, tag, search],
  )

  const project = useProject(projectId)
  const features = useFeatures(projectId, filters)
  const tags = useProjectTags(projectId)

  const hasFilters = statuses.length > 0 || tag !== '' || search !== ''
  const items = features.data?.items ?? []

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
              <h2 className="truncate text-base font-semibold text-ink">{project.data?.name}</h2>
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
          <Button variant="secondary" size="sm" onClick={() => setApplying(true)}>
            <LayoutTemplate className="h-3.5 w-3.5" />
            Template
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New feature
          </Button>
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
              {items.map((feature) => (
                <FeatureRow
                  key={feature.id}
                  feature={feature}
                  onOpen={() =>
                    navigate({ name: 'feature', projectId, featureId: feature.id })
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

function FeatureRow({ feature, onOpen }: { feature: Feature; onOpen: () => void }) {
  const tasks = feature.tasks

  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-raised"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{feature.title}</span>
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
  )
}
