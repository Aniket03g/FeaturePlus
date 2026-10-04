import { useState } from 'react'
import { LayoutTemplate, ListChecks, Package } from 'lucide-react'
import { useTemplate, useTemplates } from '@/lib/queries'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/layouts/AppShell'
import { LoadFailure } from './LinkedCode'
import { cn, plural } from '@/lib/utils'
import type { TemplateSummary } from '@/lib/types'

/**
 * The template catalogue.
 *
 * Applying a template writes features and tasks into a real project, so this
 * screen shows exactly what a template would create before anyone picks one.
 * Templates are applied from a project, not from here — a template with no
 * project to go into is a preview.
 */
export function Templates() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')

  const templates = useTemplates({ q: search })
  const items = templates.data?.items ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">Templates</h2>
          <p className="mt-0.5 text-sm text-muted">
            Starting points for a new project. Apply one from a project's own screen.
          </p>
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" />
      </div>

      {templates.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : templates.isError ? (
        <Card>
          <LoadFailure error={templates.error} onRetry={() => templates.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center">
            <LayoutTemplate className="mx-auto mb-2 h-5 w-5 text-faint" />
            <p className="text-sm font-medium text-ink">
              {search ? 'No templates match that search' : 'No templates are installed'}
            </p>
            {!search && (
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
                The catalogue lives in data/templates.json beside the application.
              </p>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              active={selected === template.id}
              onClick={() => setSelected(selected === template.id ? '' : template.id)}
            />
          ))}
        </div>
      )}

      {selected && <TemplateDetail id={selected} />}
    </div>
  )
}

function TemplateCard({
  template,
  active,
  onClick,
}: {
  template: TemplateSummary
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border bg-surface p-3.5 text-left shadow-card transition-colors',
        active ? 'border-accent' : 'border-border hover:bg-raised',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{template.name}</span>
        {template.tech_stack && <Badge tone="accent">{template.tech_stack}</Badge>}
      </div>
      {template.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted">{template.description}</p>
      )}
      <p className="mt-2 text-2xs text-faint">
        {plural(template.feature_count, 'feature')} · {plural(template.task_count, 'task')}
      </p>
    </button>
  )
}

/** What applying this template would actually create. */
export function TemplateDetail({ id }: { id: string }) {
  const template = useTemplate(id)

  if (template.isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-32 w-full" />
        </CardBody>
      </Card>
    )
  }
  if (template.isError) {
    return (
      <Card>
        <LoadFailure error={template.error} />
      </Card>
    )
  }
  if (!template.data) return null

  const data = template.data

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          {data.name}
          <span className="ml-2 font-normal text-faint">what this would create</span>
        </CardTitle>
        {data.stack && <Badge>{data.stack}</Badge>}
      </CardHeader>

      <CardBody className="grid gap-5 md:grid-cols-2">
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
            <ListChecks className="h-3 w-3" />
            {plural(data.features.length, 'feature')}
          </h4>
          {data.features.length === 0 ? (
            <p className="text-xs text-muted">None.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.features.map((feature) => (
                <li key={feature.name} className="text-xs">
                  <span className="text-ink">{feature.name}</span>
                  {feature.category && <span className="ml-1.5 text-faint">{feature.category}</span>}
                  {feature.description && (
                    <p className="text-muted">{feature.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
            <ListChecks className="h-3 w-3" />
            {plural(data.tasks.length, 'task')}
          </h4>
          {data.tasks.length === 0 ? (
            <p className="text-xs text-muted">None.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.tasks.map((task) => (
                <li key={task.name} className="text-xs">
                  <span className="text-ink">{task.name}</span>
                  {task.type && <span className="ml-1.5 text-faint">{task.type}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.dependencies.length > 0 && (
          <section className="md:col-span-2">
            <h4 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
              <Package className="h-3 w-3" />
              Packages
            </h4>
            <div className="flex flex-wrap gap-1">
              {data.dependencies.map((dependency) => (
                <Badge key={dependency}>{dependency}</Badge>
              ))}
            </div>
            <p className="mt-1.5 text-2xs text-faint">
              These are packages the stack expects. They are listed for reference and are not
              turned into feature dependencies.
            </p>
          </section>
        )}

        {data.setup_steps.length > 0 && (
          <section className="md:col-span-2">
            <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">
              Setup
            </h4>
            <ol className="list-inside list-decimal space-y-1 text-xs text-muted">
              {data.setup_steps.map((step) => (
                <li key={step}>
                  <code className="font-mono">{step}</code>
                </li>
              ))}
            </ol>
          </section>
        )}
      </CardBody>
    </Card>
  )
}
