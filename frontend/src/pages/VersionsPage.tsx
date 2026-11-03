import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Download,
  GitCompare,
  ListTree,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Save,
  Send,
  Upload,
} from 'lucide-react'
import {
  useCopies,
  useProject,
  useSetVersionNote,
  useSetWorkingNote,
  useVersion,
  useVersionsWithChanges,
  type FeatureCopy,
  type FeatureVersion,
} from '@/lib/queries'
import { downloadCopyFile, downloadVersionFile } from '@/lib/feature-file'
import { useWorkingState, versionNote } from '@/lib/working'
import { StartCopyDialog } from '@/pages/StartCopyDialog'
import { PublishDialog, RestoreDialog, SaveVersionDialog } from '@/pages/PublishDialog'
import { useRouter } from '@/lib/router'
import { NoteEditor } from '@/components/NoteEditor'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_LABEL, canPublish, type FeatureStatus } from '@/lib/types'
import { cn, plural } from '@/lib/utils'

type Tab = 'versions' | 'copies'

/** The tabs along the top of the Versions screens: the saved versions, and the published list. */
export function ProjectListTabs({
  projectId,
  active,
  versionCount,
}: {
  projectId: number
  active: 'versions' | 'published' | 'copies'
  versionCount?: number
}) {
  const { navigate } = useRouter()
  const tabs: [string, string, () => void, ReactNode][] = [
    [
      'versions',
      'Versions',
      () => navigate({ name: 'versions', projectId }),
      versionCount !== undefined ? <span className="text-faint">{versionCount}</span> : null,
    ],
    ['published', 'Published', () => navigate({ name: 'project', projectId }), null],
  ]
  return (
    <div role="tablist" aria-label="Versions and published list" className="flex gap-1 border-b border-border">
      {tabs.map(([id, label, go, extra]) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          onClick={go}
          className={cn(
            '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors',
            active === id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {label}
          {extra}
        </button>
      ))}
    </div>
  )
}

/**
 * The project's versions: every save of the Feature List (v2.1, v2.2…) and
 * every publish (v1, v2…), newest first, with the Feature List itself on top.
 * Published versions stand out in bold; the saves after a publish are drawn
 * under it. Each version can be viewed, compared, downloaded, published, or
 * put back as the Feature List.
 *
 * The Copies tab is people's own copies, made from a version.
 */
export function VersionsPage({ projectId, initialTab = 'versions' }: { projectId: number; initialTab?: Tab }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const versions = useVersionsWithChanges(projectId)
  const role = project.data?.my_role
  const canSave = role !== undefined && role !== 'viewer'
  const mayPublish = canPublish(role)

  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [justUploaded, setJustUploaded] = useState<{ id: number; message: string } | null>(null)
  const [publishedOnly, setPublishedOnly] = useState(false)
  const tab = initialTab

  const list = versions.data ?? []
  const working = useWorkingState(projectId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">{project.data?.name ?? ' '}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'versions' && (
            <>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={publishedOnly} onChange={(e) => setPublishedOnly(e.target.checked)} />
                Published only
              </label>
              {list.length >= 2 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigate({
                      name: 'compare',
                      projectId,
                      from: String((working.published && working.published.id !== list[0].id ? working.published : list[1]).id),
                      to: String(list[0].id),
                    })
                  }
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare two versions…
                </Button>
              )}
            </>
          )}
          {tab === 'copies' && list.length > 0 && (
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setStarting(true)}>
              <Download className="h-3.5 w-3.5" />
              Start a copy
            </Button>
          )}
        </div>
      </div>

      <ProjectListTabs projectId={projectId} active={tab} versionCount={versions.data?.length} />

      {tab === 'versions' ? (
        <VersionsTable
          projectId={projectId}
          versions={versions}
          publishedOnly={publishedOnly}
          canSave={canSave}
          mayPublish={mayPublish}
          onSave={() => setSaving(true)}
        />
      ) : (
        <CopiesTab
          projectId={projectId}
          canMerge={canSave}
          newest={list[0]}
          onSaveVersion={canSave ? () => setSaving(true) : undefined}
          hasVersions={list.length > 0}
          onStart={() => setStarting(true)}
          justUploaded={justUploaded}
        />
      )}

      {starting && (
        <StartCopyDialog
          projectId={projectId}
          projectName={project.data?.name ?? 'Features'}
          versions={list}
          onClose={() => setStarting(false)}
          onSaved={(copy) => {
            setStarting(false)
            navigate({ name: 'versions', projectId, tab: 'copies' })
            setJustUploaded({
              id: copy.id,
              message:
                copy.revision === 1
                  ? `Saved as your draft${copy.name ? ` “${copy.name}”` : ` copy ${copy.number}`}, based on ${copy.base.label}.`
                  : `${copy.name || `Copy ${copy.number}`} replaced with your new file.`,
            })
          }}
        />
      )}

      {saving && <SaveVersionDialog projectId={projectId} onClose={() => setSaving(false)} />}
    </div>
  )
}

// ---------- versions table ----------

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Counts({ c }: { c: { added: number; removed: number; changed: number } }) {
  if (c.added + c.removed + c.changed === 0) return <span className="font-sans text-faint">Unchanged</span>
  return (
    <span className="flex gap-1.5">
      {c.added > 0 && <span className="text-success">+{c.added}</span>}
      {c.changed > 0 && <span className="text-warning">~{c.changed}</span>}
      {c.removed > 0 && <span className="text-danger">−{c.removed}</span>}
    </span>
  )
}

function VersionsTable({
  projectId,
  versions,
  publishedOnly,
  canSave,
  mayPublish,
  onSave,
}: {
  projectId: number
  versions: ReturnType<typeof useVersionsWithChanges>
  publishedOnly: boolean
  canSave: boolean
  mayPublish: boolean
  onSave: () => void
}) {
  const { navigate } = useRouter()
  const working = useWorkingState(projectId)
  const setWorkingNote = useSetWorkingNote(projectId)
  const setVersionNote = useSetVersionNote(projectId)
  const [previewing, setPreviewing] = useState<number | null>(null)
  const [publishing, setPublishing] = useState<FeatureVersion | null>(null)
  const [opening, setOpening] = useState<FeatureVersion | null>(null)
  const [message, setMessage] = useState('')

  if (versions.isLoading) {
    return (
      <Card className="space-y-2 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Card>
    )
  }
  if (versions.isError) {
    return (
      <Card className="flex items-center gap-2 px-4 py-6 text-sm text-danger">
        Could not load the versions.
        <Button variant="secondary" size="sm" onClick={() => versions.refetch()}>
          Try again
        </Button>
      </Card>
    )
  }

  const all = versions.data ?? []
  const shown = publishedOnly ? all.filter((v) => v.publish_number > 0) : all
  const unsaved = working.unsaved ?? 0
  const base = working.latest
  const changed = unsaved > 0 || working.neverSaved
  const goToWorking = () => navigate({ name: 'inProgress', projectId })

  return (
    <div className="space-y-3">
      {message && (
        <p role="status" className="rounded-md border border-success/40 bg-success-soft/30 px-3 py-2 text-xs text-ink">
          {message}
        </p>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="whitespace-nowrap border-b border-border text-left text-2xs font-semibold uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-semibold">Version</th>
              <th className="px-4 py-2.5 font-semibold">Based on</th>
              <th className="px-4 py-2.5 font-semibold">Note</th>
              <th className="px-4 py-2.5 font-semibold">Saved by</th>
              <th className="px-4 py-2.5 font-semibold">When</th>
              <th className="px-4 py-2.5 font-semibold">Changes</th>
              <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* The working version, on top: what it is based on, and whether it changed since. */}
            <tr className={cn(changed ? 'bg-warning-soft/20' : 'bg-accent-soft/10')}>
              <td className="whitespace-nowrap px-4 py-3">
                <span className="flex items-center gap-2 text-ink">
                  <span className={cn('h-2 w-2 rounded-full', changed ? 'bg-warning' : 'bg-success')} aria-hidden />
                  Working version
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">{base ? base.label : '—'}</td>
              <td className="min-w-[16rem] max-w-sm px-4 py-3">
                <NoteEditor
                  note={working.note}
                  empty={canSave ? 'Add a note' : 'No note'}
                  title={working.note && working.noteBy ? `Note by ${working.noteBy}` : undefined}
                  onSave={canSave ? (note) => setWorkingNote.mutateAsync(note) : undefined}
                />
              </td>
              <td className="px-4 py-3 text-muted">—</td>
              <td className="px-4 py-3 text-muted">now</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                {working.neverSaved ? (
                  <span className="font-sans text-warning">Not saved yet</span>
                ) : working.unsavedCounts ? (
                  <Counts c={working.unsavedCounts} />
                ) : (
                  <span className="text-faint">…</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" className="whitespace-nowrap" onClick={goToWorking}>
                    <ListTree className="h-3.5 w-3.5" />
                    Go to working version
                  </Button>
                  {base && unsaved > 0 && (
                    <RowMenu
                      label="More for the working version"
                      items={[
                        {
                          icon: <GitCompare className="h-3.5 w-3.5" />,
                          text: `See the changes since ${base.label}`,
                          onClick: () => navigate({ name: 'compare', projectId, from: String(base.id), to: 'current' }),
                        },
                        ...(mayPublish
                          ? [
                              {
                                icon: <RotateCcw className="h-3.5 w-3.5" />,
                                text: 'Discard the changes',
                                onClick: () => setOpening(base),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                  {canSave && changed && (
                    <Button size="sm" className="whitespace-nowrap" onClick={onSave}>
                      <Save className="h-3.5 w-3.5" />
                      Save as <span className="font-mono">{working.nextSave}</span>
                    </Button>
                  )}
                  {mayPublish && base && unsaved === 0 && base.publish_number === 0 && (
                    <Button size="sm" className="whitespace-nowrap" onClick={() => setPublishing(base)}>
                      <Send className="h-3.5 w-3.5" />
                      Publish <span className="font-mono">{base.label}</span>
                    </Button>
                  )}
                </div>
              </td>
            </tr>

            {shown.map((v) => (
              <VersionRow
                key={v.id}
                projectId={projectId}
                version={v}
                live={base?.id === v.id}
                indent={!publishedOnly && v.publish_number === 0 && v.major > 0}
                previewing={previewing === v.id}
                onPreview={() => setPreviewing(previewing === v.id ? null : v.id)}
                onView={
                  base?.id === v.id ? goToWorking : mayPublish ? () => setOpening(v) : undefined
                }
                onPublish={mayPublish && working.published?.id !== v.id ? () => setPublishing(v) : undefined}
                onNote={canSave ? (notes) => setVersionNote.mutateAsync({ versionId: v.id, notes }) : undefined}
              />
            ))}
          </tbody>
        </table>
        {all.length === 0 && (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto mb-3 w-fit text-faint">
              <StackPicture />
            </div>
            <p className="text-sm font-medium text-ink">No versions yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">
              Save the working version to keep it as it is now. Saves count up as v0.1, v0.2… and publishing one
              makes it v1, the list everyone reads.
            </p>
          </div>
        )}
      </Card>
      <p className="text-xs text-faint">
        <span className="font-medium text-muted">Live</span> marks the version the working version is based on.{' '}
        {mayPublish ? 'View opens a version as the working version.' : 'Only the owner or a publisher can open a version as the working version.'}
      </p>

      {publishing && (
        <PublishDialog
          projectId={projectId}
          version={publishing}
          onClose={() => setPublishing(null)}
          onPublished={(label) => setMessage(`Published as ${label}. Everyone now reads this list.`)}
        />
      )}
      {opening && (
        <RestoreDialog
          projectId={projectId}
          version={opening}
          onClose={() => setOpening(null)}
          onDone={() => navigate({ name: 'inProgress', projectId })}
        />
      )}
    </div>
  )
}

function VersionRow({
  projectId,
  version,
  live,
  indent,
  previewing,
  onPreview,
  onView,
  onPublish,
  onNote,
}: {
  projectId: number
  version: FeatureVersion
  /** The working version is based on this one. */
  live: boolean
  indent: boolean
  previewing: boolean
  onPreview: () => void
  /** Opens it as the working version; missing without the right to. */
  onView?: () => void
  onPublish?: () => void
  onNote?: (notes: string) => Promise<unknown>
}) {
  const { navigate } = useRouter()
  const published = version.publish_number > 0
  const c = version.changes
  const [downloading, setDownloading] = useState(false)

  async function download() {
    setDownloading(true)
    try {
      await downloadVersionFile(projectId, version.id)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <tr className={cn(live ? 'bg-accent-soft/10' : published && 'bg-success-soft/10')}>
        <td className="whitespace-nowrap px-4 py-3">
          <div className={cn('flex items-center gap-2', indent && 'pl-5')}>
            {indent && <span aria-hidden className="-ml-4 h-3 w-3 rounded-bl border-b border-l border-border" />}
            <span className={cn('font-mono', published ? 'font-bold text-ink' : 'text-muted')}>{version.label}</span>
            {published && <Badge tone="success">Published</Badge>}
            {live && (
              <Badge tone="accent" title="The working version is based on this version">
                Live
              </Badge>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">
          {version.based_on ? version.based_on.label : '—'}
        </td>
        <td className="min-w-[16rem] max-w-sm px-4 py-3">
          <NoteEditor note={versionNote(version)} strong={published} onSave={onNote} />
        </td>
        <td className={cn('whitespace-nowrap px-4 py-3', published ? 'font-semibold text-ink' : 'text-muted')}>
          {version.saved_by.name || 'someone since removed'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-muted">{when(version.published_at ?? version.created_at)}</td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
          {c ? <Counts c={c} /> : <span className="font-sans text-muted">{plural(version.feature_count, 'feature')}</span>}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1.5">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onView}
                title={live ? 'Go to the working version' : `Open ${version.label} as the working version`}
              >
                View
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate({ name: 'compare', projectId, from: String(version.id), to: 'current' })}
              title={`What changed from ${version.label} to the working version`}
            >
              Compare
            </Button>
            <RowMenu
              label={`More for ${version.label}`}
              items={[
                ...(onPublish
                  ? [{ icon: <Send className="h-3.5 w-3.5" />, text: `Publish ${version.label}`, onClick: onPublish }]
                  : []),
                {
                  icon: <ListTree className="h-3.5 w-3.5" />,
                  text: previewing ? 'Hide the list' : 'Look at the list',
                  onClick: onPreview,
                },
                {
                  icon: downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />,
                  text: 'Download .md',
                  onClick: download,
                },
              ]}
            />
          </div>
        </td>
      </tr>
      {previewing && (
        <tr>
          <td colSpan={7} className="bg-raised/30 px-4 py-3">
            <VersionTree projectId={projectId} versionId={version.id} />
          </td>
        </tr>
      )}
    </>
  )
}

/** A "⋯" button with a short menu under it. */
function RowMenu({
  label,
  items,
}: {
  label: string
  items: { icon: ReactNode; text: string; onClick: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-pop"
        >
          {items.map((item) => (
            <button
              key={item.text}
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-raised"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              <span className="text-muted">{item.icon}</span>
              {item.text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- copies tab ----------

type CopyFilter = 'all' | 'mine' | 'published' | 'merged'

const COPY_FILTERS: { id: CopyFilter; label: string; keep: (copy: FeatureCopy) => boolean }[] = [
  { id: 'all', label: 'All', keep: () => true },
  { id: 'mine', label: 'Mine', keep: (copy) => copy.mine },
  { id: 'published', label: 'Published', keep: (copy) => Boolean(copy.published_at) && !copy.merged_at },
  { id: 'merged', label: 'Merged', keep: (copy) => Boolean(copy.merged_at) },
]

/**
 * Copies: the upload that makes or replaces one, and one list of every copy
 * you can see — your own, and everyone's published ones — each shown once
 * with where it stands.
 */
function CopiesTab({
  projectId,
  canMerge,
  newest,
  onSaveVersion,
  hasVersions,
  onStart,
  justUploaded,
}: {
  projectId: number
  canMerge: boolean
  /** The newest version, which an empty tab offers to download. */
  newest?: FeatureVersion
  onSaveVersion?: () => void
  hasVersions: boolean
  onStart: () => void
  justUploaded: { id: number; message: string } | null
}) {
  const copies = useCopies(projectId)
  const [filter, setFilter] = useState<CopyFilter>('all')
  const all = copies.data ?? []
  const shown = all.filter(COPY_FILTERS.find((f) => f.id === filter)!.keep)
  const done = justUploaded

  // Nothing yet: the empty screen explains copies in place of the strip and list.
  if (!copies.isLoading && !copies.isError && all.length === 0) {
    return <CopiesEmpty projectId={projectId} newest={newest} onStart={onStart} onSaveVersion={onSaveVersion} />
  }

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <Step n={1}>Download a version as .md</Step>
            <ChevronRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            <Step n={2}>Edit it in any editor</Step>
            <ChevronRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            <Step n={3}>Upload it here</Step>
          </ol>
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={!hasVersions}
            title={hasVersions ? 'Download a version, or upload a file you have edited' : 'Save a version first; copies are made from versions'}
            onClick={onStart}
          >
            <Upload className="h-3.5 w-3.5" />
            Start a copy or upload
          </Button>
        </div>
        <p className="mt-2 text-xs text-faint">
          Your copies are private to you.
        </p>
      </Card>

      {done && (
        <p role="status" className="rounded-md border border-success/40 bg-success-soft px-3 py-2 text-xs text-ink">
          {done.message}
        </p>
      )}

      {all.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show copies">
          {COPY_FILTERS.map((f) => {
            const count = all.filter(f.keep).length
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs transition-colors',
                  filter === f.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-muted hover:border-accent/50 hover:text-ink',
                )}
              >
                {f.label}
                <span className="text-2xs opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {copies.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : copies.isError ? (
        <p className="text-xs text-danger">Could not load the copies.</p>
      ) : all.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted">No copies yet.</Card>
      ) : shown.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted">Nothing here.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {shown.map((copy) => (
              <CopyRow key={copy.id} projectId={projectId} copy={copy} isNew={copy.id === done?.id} canMerge={canMerge} />
            ))}
          </ul>
        </Card>
      )}

    </div>
  )
}

/** The Copies tab before anyone has made a copy. */
function CopiesEmpty({
  projectId,
  newest,
  onStart,
  onSaveVersion,
}: {
  projectId: number
  newest?: FeatureVersion
  onStart: () => void
  onSaveVersion?: () => void
}) {
  const [downloading, setDownloading] = useState(false)

  if (!newest) {
    return (
      <EmptyScreen
        picture={<LoopPicture />}
        title="No copies yet"
        text="Copies are made from saved versions, and this project has none yet. Once a version is saved, anyone on the project can download it, edit it, and suggest changes."
      >
        {onSaveVersion ? (
          <Button onClick={onSaveVersion}>Save the first version</Button>
        ) : (
          <p className="text-sm text-faint">Ask an editor or owner to save the first version.</p>
        )}
      </EmptyScreen>
    )
  }

  async function download() {
    setDownloading(true)
    try {
      await downloadVersionFile(projectId, newest!.id)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <EmptyScreen
      picture={<LoopPicture />}
      title="No copies yet"
      text="Want to suggest changes without touching the real list? Download a version, edit it in any text editor, and upload it here. It stays private to you."
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={download} loading={downloading} className="gap-1.5">
          <Download className="h-4 w-4" />
          Download {newest.label} to start
        </Button>
        <Button variant="secondary" onClick={onStart} className="gap-1.5">
          <Upload className="h-4 w-4" />
          Upload edited file
        </Button>
      </div>
    </EmptyScreen>
  )
}

/** A friendly empty state: a small picture, what this is, and the first thing to do. */
function EmptyScreen({ picture, title, text, children }: { picture: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-6" aria-hidden>
        {picture}
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-muted">{text}</p>
      <div className="mt-6">{children}</div>
    </Card>
  )
}

/** Stacked pages with a plus: saved snapshots. */
function StackPicture() {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none">
      <rect x="34" y="6" width="68" height="56" rx="7" className="fill-raised stroke-border" strokeWidth="1.5" />
      <rect x="26" y="14" width="68" height="56" rx="7" className="fill-raised stroke-border" strokeWidth="1.5" />
      <rect x="18" y="22" width="68" height="56" rx="7" className="fill-surface stroke-accent" strokeWidth="1.5" />
      <rect x="30" y="34" width="26" height="5" rx="2.5" className="fill-accent" opacity="0.8" />
      <rect x="34" y="46" width="34" height="3" rx="1.5" className="fill-border" />
      <rect x="38" y="54" width="26" height="3" rx="1.5" className="fill-border" />
      <rect x="42" y="62" width="20" height="3" rx="1.5" className="fill-border" />
      <circle cx="86" cy="76" r="13" className="fill-accent" />
      <path d="M86 70v12M80 76h12" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

/** Download, edit, upload: the copy loop. */
function LoopPicture() {
  const circle = (cx: number, active: boolean) => (
    <circle cx={cx} cy="34" r="20" className={active ? 'fill-accent-soft stroke-accent' : 'fill-raised stroke-border'} strokeWidth="1.5" />
  )
  return (
    <svg width="160" height="80" viewBox="0 0 160 80" fill="none">
      <path d="M44 34h12M104 34h12" className="stroke-border" strokeWidth="2" />
      <path d="M30 56 C 50 78, 110 78, 130 56" className="stroke-border" strokeWidth="1.5" strokeDasharray="3 4" />
      {circle(24, true)}
      {circle(80, false)}
      {circle(136, false)}
      <path d="M24 25v16m-6-6 6 6 6-6" className="stroke-accent" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M74 40l2-6 9-9 4 4-9 9-6 2z" className="stroke-muted" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M136 43V27m-6 6 6-6 6 6" className="stroke-muted" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-2xs text-ink">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}

function CopyRow({
  projectId,
  copy,
  isNew,
  canMerge,
}: {
  projectId: number
  copy: FeatureCopy
  isNew: boolean
  canMerge: boolean
}) {
  const { navigate } = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  async function download() {
    setState('busy')
    try {
      await downloadCopyFile(projectId, copy.id)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  const when = new Date(copy.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const title = copy.name || `Copy ${copy.number}`
  const seeChanges = () => navigate({ name: 'compare', projectId, from: String(copy.base.id), to: `c${copy.id}` })

  return (
    <li className={cn(isNew && 'bg-accent-soft/40')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              className="truncate text-left text-sm font-medium text-ink hover:underline"
              onClick={seeChanges}
              title={`See what ${title} changes from ${copy.base.label}`}
            >
              {title}
            </button>
            {copy.name && <span className="shrink-0 font-mono text-2xs text-faint">#{copy.number}</span>}
            {copy.merged_at ? (
              <Badge tone="success">Merged{copy.merged_version ? ` into v${copy.merged_version.number}` : ''}</Badge>
            ) : copy.published_at ? (
              <Badge tone="accent">Published</Badge>
            ) : (
              <Badge tone="neutral">Draft</Badge>
            )}
          </div>
          <p className="text-xs text-muted">
            {copy.mine ? 'You' : copy.owner.name || 'A removed account'} · from {copy.base.label}
            {copy.base.tag ? ` ${copy.base.tag}` : ''} · {when} · {plural(copy.feature_count, 'feature')}
            {copy.revision > 1 && ` · uploaded ${copy.revision} times`}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={seeChanges}
            title={`See what ${title} changes from ${copy.base.label}, as a tree`}
          >
            <GitCompare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">See changes</span>
          </Button>
          {canMerge && copy.published_at && !copy.merged_at && (
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => navigate({ name: 'merge', projectId, copyId: copy.id })}
              title="See what merging this copy would change in the project's list"
            >
              Review &amp; merge
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', state === 'failed' && 'text-danger')}
            onClick={download}
            disabled={state === 'busy'}
            title="Download as .md, to edit and upload again"
            aria-label={`Download ${title}`}
          >
            {state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {state === 'failed' ? 'Failed' : '.md'}
          </Button>
        </div>
      </div>
    </li>
  )
}

/** A saved version read back as the tree it was, read-only. */
function VersionTree({ projectId, versionId }: { projectId: number; versionId: number }) {
  const version = useVersion(projectId, versionId)

  if (version.isLoading) {
    return (
      <div className="space-y-1.5 px-4 pb-4 pl-14">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
    )
  }
  if (version.isError || !version.data) {
    return <p className="px-4 pb-4 pl-14 text-xs text-danger">Could not open this version.</p>
  }

  const rows = version.data.snapshot.features
  const depth = new Map<string, number>()
  for (const row of rows) {
    depth.set(row.key, row.parent_key ? (depth.get(row.parent_key) ?? 0) + 1 : 0)
  }
  const titles = new Map(rows.map((row) => [row.key, row.title]))

  if (rows.length === 0) {
    return <p className="px-4 pb-4 pl-14 text-xs text-faint">This version has no features.</p>
  }

  return (
    <ul className="mx-4 mb-4 ml-14 rounded-md border border-border bg-raised/30 py-1">
      {rows.map((row) => {
        const d = depth.get(row.key) ?? 0
        const status = row.status as FeatureStatus | undefined
        return (
          <li key={row.key} className="px-3 py-1" style={{ paddingLeft: `${0.75 + d * 1.25}rem` }}>
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint">L{d}</span>
              <span className="truncate text-sm text-ink">{row.title}</span>
              {status && status !== 'todo' && (
                <span className="shrink-0 text-2xs text-muted">{STATUS_LABEL[status] ?? status}</span>
              )}
            </div>
            {row.description && <p className="ml-8 line-clamp-2 text-xs text-faint">{row.description}</p>}
            {row.needs.length > 0 && (
              <p className="ml-8 text-2xs text-faint">needs {row.needs.map((k) => titles.get(k) ?? '?').join(', ')}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
