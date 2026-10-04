import { useState } from 'react'
import { ArrowLeft, BookOpen, Copy, Download, FileCode, Lock } from 'lucide-react'
import { useBriefing, useProject } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError, fileUrl } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { plural } from '@/lib/utils'

/**
 * The collaborator briefing: everything you need to build your feature and
 * nothing you are not entitled to see.
 *
 * A project owner gets a 404 here, and that is not a bug. A briefing is
 * assembled from access grants, and someone who already has the whole
 * repository has no grants to assemble it from — the tool they want is the
 * project itself.
 */
export function BriefingPage({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const briefing = useBriefing(projectId)
  const [copied, setCopied] = useState(false)

  async function copyMarkdown() {
    try {
      const response = await fetch(fileUrl(`/projects/${projectId}/briefing`, { format: 'md' }), {
        credentials: 'include',
      })
      await navigator.clipboard.writeText(await response.text())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
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
          <h2 className="text-base font-semibold text-ink">Briefing</h2>
          <p className="mt-0.5 text-sm text-muted">{project.data?.name}</p>
        </div>

        {briefing.data && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={copyMarkdown}>
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy as Markdown'}
            </Button>
            <a
              href={fileUrl(`/projects/${projectId}/briefing`, { format: 'md' })}
              download={`briefing-${projectId}.md`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-raised"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </div>
        )}
      </div>

      {briefing.isLoading ? (
        <Card>
          <CardBody className="space-y-3">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-40 w-full" />
          </CardBody>
        </Card>
      ) : briefing.isError ? (
        <NoBriefing error={briefing.error} />
      ) : briefing.data ? (
        <BriefingBody briefing={briefing.data} />
      ) : null}
    </div>
  )
}

function NoBriefing({ error }: { error: unknown }) {
  const notFound = error instanceof ApiError && error.code === 'not_found'

  return (
    <Card>
      <CardBody className="py-14 text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
          <Lock className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-ink">
          {notFound ? 'There is no briefing for you here' : 'The briefing could not be built'}
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted">
          {notFound
            ? 'A briefing is assembled from the features you have been granted. If you own this project you already have all of it, and if you are a collaborator, nobody has granted you a feature yet.'
            : error instanceof ApiError
              ? error.message
              : 'The server could not be reached.'}
        </p>
      </CardBody>
    </Card>
  )
}

function BriefingBody({ briefing }: { briefing: NonNullable<ReturnType<typeof useBriefing>['data']> }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{briefing.project.name}</CardTitle>
          {briefing.project.tech_stack && <Badge tone="accent">{briefing.project.tech_stack}</Badge>}
        </CardHeader>
        {briefing.project.brief && (
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-muted">{briefing.project.brief}</p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            What you are building
            <span className="ml-2 font-normal text-faint">
              {plural(briefing.your_features.length, 'feature')}
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {briefing.your_features.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted">
              No features have been assigned to you yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {briefing.your_features.map((feature) => (
                <li key={feature.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{feature.title}</span>
                    {feature.status && <Badge>{feature.status}</Badge>}
                  </div>
                  {feature.description && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                      {feature.description}
                    </p>
                  )}
                  {feature.tasks.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {feature.tasks.map((task) => (
                        <li key={task.id} className="flex items-start gap-2 text-xs">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-faint" />
                          <span className="text-muted">
                            {task.task_name}
                            {task.task_type && (
                              <span className="ml-1.5 text-faint">{task.task_type}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            What you depend on
            <span className="ml-2 font-normal text-faint">
              contracts only, never the implementation
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {briefing.dependencies.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted">
              Your features do not depend on anything else in this project.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {briefing.dependencies.map((dependency) => (
                <li key={dependency.feature_id} className="px-4 py-3">
                  <p className="text-sm font-medium text-ink">{dependency.title}</p>
                  {dependency.description && (
                    <p className="mt-0.5 text-xs text-muted">{dependency.description}</p>
                  )}
                  <div className="mt-2 space-y-2">
                    {dependency.files.map((file) => (
                      <DependencyFile key={file.file_path} file={file} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {briefing.rules && (
        <Card>
          <CardHeader>
            <CardTitle>Ground rules</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-muted">{briefing.rules}</p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function DependencyFile({
  file,
}: {
  file: { file_path: string; contract?: string; note?: string; stale?: boolean }
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-md border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-raised"
      >
        <FileCode className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{file.file_path}</span>
        {file.stale && <Badge tone="warning">stale</Badge>}
        <BookOpen className="h-3 w-3 shrink-0 text-faint" />
      </button>

      {open && (
        <div className="border-t border-border">
          {file.note && (
            <p className="border-b border-border bg-raised/50 px-3 py-2 text-xs text-muted">
              {file.note}
            </p>
          )}
          <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-2xs leading-relaxed text-ink">
            {file.contract || 'No contract has been extracted for this file yet.'}
          </pre>
        </div>
      )}
    </div>
  )
}
