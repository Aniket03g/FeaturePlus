import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Download,
  History,
  Loader2,
  Lock,
  Network,
  Pencil,
  Send,
  Users,
} from 'lucide-react'
import { useFeatureAttachments, useProject, usePublished, type FeatureVersionDetail } from '@/lib/queries'
import { downloadVersionFile } from '@/lib/feature-file'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, PriorityPill } from '@/components/FeatureBits'
import { Markdown } from '@/components/Markdown'
import { ShareDialog } from './ShareDialog'
import { cn, plural } from '@/lib/utils'
import { ROLE_LABEL, canManage, type FeaturePriority, type FeatureStatus } from '@/lib/types'

type Row = FeatureVersionDetail['snapshot']['features'][number]

/** Indent per level, in pixels, as in the Working list. */
const INDENT = 20

/**
 * The published feature list: the latest version published from the
 * Working list, exactly as it was then. Nothing here can be edited; it
 * changes only when someone publishes again.
 *
 * A row opens in place to show that feature's published description and
 * notes, rather than leading to the live feature, which may have moved on.
 */
export function PublishedList({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const published = usePublished(projectId)
  const [sharing, setSharing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const role = project.data?.my_role
  const canPublish = role !== undefined && role !== 'viewer'
  const version = published.data ?? null

  // Each row's depth, from its parent's; snapshots list parents before children.
  const depth = useMemo(() => {
    const out = new Map<string, number>()
    for (const row of version?.snapshot.features ?? []) {
      out.set(row.key, row.parent_key ? (out.get(row.parent_key) ?? 0) + 1 : 0)
    }
    return out
  }, [version])

  async function download() {
    if (!version) return
    setDownloading(true)
    try {
      await downloadVersionFile(projectId, version.id)
    } finally {
      setDownloading(false)
    }
  }

  if (project.isError || published.isError) {
    const err = project.error ?? published.error
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">{err instanceof ApiError ? err.message : 'Could not load the published list'}</span>
        </CardBody>
      </Card>
    )
  }

  const rows = version?.snapshot.features ?? []
  const done = rows.filter((r) => r.status === 'done').length
  const when = version?.published_at
    ? new Date(version.published_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : ''

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
                <Badge>Published</Badge>
                {role && role !== 'owner' && (
                  <Badge tone={role === 'admin' ? 'warning' : 'neutral'}>{ROLE_LABEL[role]}</Badge>
                )}
              </div>
              {project.data?.description && <p className="mt-0.5 text-sm text-muted">{project.data.description}</p>}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'dependencies', projectId })}>
            <Network className="h-3.5 w-3.5" />
            Dependencies
          </Button>
          {version && (
            <Button variant="secondary" size="sm" onClick={download} disabled={downloading} title="Save the published list as a .md file">
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download .md
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'versions', projectId })}>
            <History className="h-3.5 w-3.5" />
            Versions
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
            <Users className="h-3.5 w-3.5" />
            Share
          </Button>
        </div>
      </div>

      {published.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !version ? (
        <Card>
          <CardBody className="px-4 py-14 text-center">
            <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
              <Send className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-ink">Nothing published yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">
              The published list is the agreed plan. It is made by publishing the Working list
              {canPublish ? '.' : ', which an owner or editor of this project can do.'}
            </p>
            {canPublish && (
              <Button size="sm" className="mt-3" onClick={() => navigate({ name: 'inProgress', projectId })}>
                <Pencil className="h-3.5 w-3.5" />
                Go to the Working list to publish
              </Button>
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-raised px-3 py-2 text-xs text-muted">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">Published #{version.publish_number}</span>
              {' · '}
              {when} by {version.saved_by.name || 'someone since removed'}
              {' · '}
              {plural(rows.length, 'feature')}, {done} done
              {version.notes && <span className="block text-muted">“{version.notes}”</span>}
            </span>
            {canPublish && (
              <Button variant="secondary" size="sm" className="h-7" onClick={() => navigate({ name: 'inProgress', projectId })}>
                <Pencil className="h-3 w-3" />
                Edit in the Working list
              </Button>
            )}
          </div>

          <Card>
            <CardBody className="p-0">
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted">This publish has no features.</p>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map((row) => (
                    <PublishedRow
                      key={row.key}
                      row={row}
                      depth={depth.get(row.key) ?? 0}
                      open={open[row.key] ?? false}
                      onToggle={() => setOpen((now) => ({ ...now, [row.key]: !now[row.key] }))}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </>
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

function PublishedRow({
  row,
  depth,
  open,
  onToggle,
}: {
  row: Row
  depth: number
  open: boolean
  onToggle: () => void
}) {
  const hasDetails = Boolean(row.description?.trim() || row.notes?.trim())

  return (
    <div>
      <button
        type="button"
        onClick={hasDetails ? onToggle : undefined}
        aria-expanded={hasDetails ? open : undefined}
        className={cn(
          'relative flex w-full items-center gap-2 py-2.5 pr-4 text-left',
          hasDetails ? 'hover:bg-raised' : 'cursor-default',
        )}
        style={{ paddingLeft: 16 + depth * INDENT }}
      >
        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: 16 + 9 + i * INDENT }} />
        ))}
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90', !hasDetails && 'invisible')}
        />
        <span className="shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint">L{depth}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.title}</span>
        {row.status && <StatusPill status={row.status as FeatureStatus} />}
        {row.priority && <PriorityPill priority={row.priority as FeaturePriority} />}
      </button>
      {open && hasDetails && <PublishedDetails row={row} depth={depth} />}
    </div>
  )
}

/** A feature's description and notes as published. Pictures come from the live feature's files. */
function PublishedDetails({ row, depth }: { row: Row; depth: number }) {
  const files = useFeatureAttachments(row.feature_id)
  const attachments = files.data?.items ?? []

  return (
    <div className="space-y-3 border-t border-border bg-raised/30 py-3 pr-4" style={{ paddingLeft: 16 + depth * INDENT + 22 }}>
      {row.description?.trim() && <Markdown text={row.description} attachments={attachments} />}
      {row.notes?.trim() && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">Notes</h3>
          <Markdown text={row.notes} attachments={attachments} />
        </section>
      )}
    </div>
  )
}
