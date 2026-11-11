import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  Download,
  Eye,
  GitCompare,
  ListTree,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  useCopies,
  useDeletedVersions,
  useDeleteVersion,
  usePermanentDeleteVersion,
  useProject,
  useSetVersionNote,
  useUndeleteVersion,
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
import { ApiError } from '@/lib/api'
import { Dialog } from '@/components/Dialog'
import { NoteEditor } from '@/components/NoteEditor'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_LABEL, canDownload, canEditPlan, canPublish, type FeatureStatus } from '@/lib/types'
import { cn, plural } from '@/lib/utils'

type Tab = 'versions' | 'copies' | 'deleted'

/** The tabs along the top of the Versions screens: the saved versions, and the published list. */
export function ProjectListTabs({
  projectId,
  active,
  versionCount,
}: {
  projectId: number
  active: 'versions' | 'published' | 'copies' | 'deleted'
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
    ['deleted', 'Deleted', () => navigate({ name: 'versions', projectId, tab: 'deleted' }), null],
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
            // The Deleted tab is kept subdued, since it is a side bin, not a main view.
            id === 'deleted'
              ? active === id
                ? 'border-faint text-muted'
                : 'border-transparent text-faint hover:text-muted'
              : active === id
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-ink',
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
  // Editors open versions as the working version; publishers download.
  const mayOpen = canEditPlan(role)
  const mayDownload = canDownload(role)

  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [justUploaded, setJustUploaded] = useState<{ id: number; message: string } | null>(null)
  const tab = initialTab

  const list = versions.data ?? []
  const working = useWorkingState(projectId)
  const unsaved = working.unsaved ?? 0
  const base = working.latest
  const changed = unsaved > 0 || working.neverSaved
  const goToWorking = () => navigate({ name: 'inProgress', projectId })
  const [publishAfterSave, setPublishAfterSave] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">{project.data?.name ?? ' '}</h2>
          {/* The working version, just below the project name: what it is based on,
              whether it has changed, and the ways to act on it. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-ink">Current version is</span>
            <span className="text-muted">
              Based on: <span className="font-mono font-semibold text-ink">{base ? base.label : '—'}</span>
            </span>
            <span className="text-faint">·</span>
            {working.neverSaved ? (
              <span className="font-medium text-warning">Not saved yet</span>
            ) : changed ? (
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-warning">Changed</span>
                {working.unsavedCounts && <Counts c={working.unsavedCounts} />}
              </span>
            ) : (
              <span className="font-medium text-success">Unchanged</span>
            )}
            <Button variant="secondary" size="sm" className="h-7" onClick={goToWorking}>
              <ListTree className="h-3.5 w-3.5" />
              Go to working version
            </Button>
            {canSave && changed && (
              <span className="flex items-center gap-2 whitespace-nowrap">
                {mayPublish && (
                  <label
                    className="flex cursor-pointer items-center gap-1.5 text-muted"
                    title={`Publish ${working.nextSave} as ${working.nextPublish} right after saving`}
                  >
                    <input
                      type="checkbox"
                      checked={publishAfterSave}
                      onChange={(e) => setPublishAfterSave(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border accent-accent"
                    />
                    Publish
                  </label>
                )}
                <Button size="sm" className="h-7" onClick={() => setSaving(true)}>
                  <Save className="h-3.5 w-3.5" />
                  Save as <span className="font-mono">{working.nextSave}</span>
                </Button>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          publishedOnly={false}
          canSave={canSave}
          mayPublish={mayPublish}
          mayOpen={mayOpen}
          mayDownload={mayDownload}
        />
      ) : tab === 'deleted' ? (
        <DeletedTable projectId={projectId} canSave={canSave} />
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

      {saving && (
        <SaveVersionDialog
          projectId={projectId}
          publishAfter={publishAfterSave && mayPublish}
          onClose={() => setSaving(false)}
        />
      )}
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

// ---------- deleted tab ----------

/**
 * The versions marked as deleted. A side bin, drawn subdued: each row can be
 * brought back (Undo delete) or removed for good (Delete permanently).
 */
function DeletedTable({ projectId, canSave }: { projectId: number; canSave: boolean }) {
  const deleted = useDeletedVersions(projectId)
  const undelete = useUndeleteVersion(projectId)
  const permaDelete = usePermanentDeleteVersion(projectId)
  const [confirming, setConfirming] = useState<FeatureVersion | null>(null)
  const [error, setError] = useState('')

  async function confirmPermanent() {
    if (!confirming) return
    setError('')
    try {
      await permaDelete.mutateAsync(confirming.id)
      setConfirming(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the version')
    }
  }

  if (deleted.isLoading) {
    return (
      <Card className="space-y-2 p-4">
        <Skeleton className="h-10 w-full" />
      </Card>
    )
  }
  if (deleted.isError) {
    return (
      <Card className="flex items-center gap-2 px-4 py-6 text-sm text-danger">
        Could not load the deleted versions.
        <Button variant="secondary" size="sm" onClick={() => deleted.refetch()}>
          Try again
        </Button>
      </Card>
    )
  }

  const rows = deleted.data ?? []

  return (
    <div className="space-y-3">
      <Card className="overflow-x-auto bg-raised/30">
        <table className="w-full min-w-[800px] text-sm text-muted">
          <thead>
            <tr className="whitespace-nowrap border-b border-border text-left text-2xs font-semibold uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-semibold">Version</th>
              <th className="px-4 py-2.5 font-semibold">Based on</th>
              <th className="px-4 py-2.5 font-semibold">Actions</th>
              <th className="px-4 py-2.5 font-semibold">Saved by</th>
              <th className="px-4 py-2.5 font-semibold">When</th>
              <th className="px-4 py-2.5 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((v) => (
              <tr key={v.id} className="text-faint">
                <td className="whitespace-nowrap px-4 py-3 font-mono line-through">{v.label}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  {v.based_on ? v.based_on.label : '—'}
                </td>
                <td className="px-4 py-3">
                  {canSave ? (
                    <RowMenu
                      label={`Actions for ${v.label}`}
                      items={[
                        {
                          icon: <RotateCcw className="h-3.5 w-3.5" />,
                          text: 'Undo delete',
                          onClick: () => undelete.mutate(v.id),
                        },
                        {
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          text: 'Delete permanently',
                          onClick: () => setConfirming(v),
                        },
                      ]}
                    />
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{v.saved_by.name || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3">{when(v.published_at ?? v.created_at)}</td>
                <td className="min-w-[14rem] max-w-sm px-4 py-3">
                  {versionNote(v) || <span className="text-faint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted">No deleted versions.</div>
        )}
      </Card>

      {confirming && (
        <Dialog title={`Delete ${confirming.label} for good?`} onClose={() => setConfirming(null)}>
          <div className="space-y-2 p-4 text-sm text-muted">
            <p>
              <span className="font-mono text-ink">{confirming.label}</span> is removed for good and cannot be brought
              back.
            </p>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={permaDelete.isPending} onClick={confirmPermanent}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete permanently
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export function VersionsTable({
  projectId,
  versions,
  publishedOnly,
  canSave,
  mayPublish,
  mayOpen,
  mayDownload,
}: {
  projectId: number
  versions: ReturnType<typeof useVersionsWithChanges>
  publishedOnly: boolean
  canSave: boolean
  mayPublish: boolean
  /** Editor and up: open a version as the working version, or discard changes. */
  mayOpen: boolean
  /** Owner and publishers: download a version as .md. */
  mayDownload: boolean
}) {
  const { navigate } = useRouter()
  const working = useWorkingState(projectId)
  const deleteVersion = useDeleteVersion(projectId)
  const [previewing, setPreviewing] = useState<number | null>(null)
  const [publishing, setPublishing] = useState<FeatureVersion | null>(null)
  const [opening, setOpening] = useState<FeatureVersion | null>(null)
  const [noting, setNoting] = useState<FeatureVersion | null>(null)
  const [deleting, setDeleting] = useState<FeatureVersion | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [message, setMessage] = useState('')

  async function confirmDelete() {
    if (!deleting) return
    setDeleteError('')
    try {
      await deleteVersion.mutateAsync(deleting.id)
      setMessage(`${deleting.label} was marked as deleted.`)
      setDeleting(null)
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete the version')
    }
  }

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
  const base = working.latest
  const changed = (working.unsaved ?? 0) > 0 || working.neverSaved
  const goToWorking = () => navigate({ name: 'inProgress', projectId })

  return (
    <div className="space-y-3">
      {message && (
        <p role="status" className="rounded-md border border-success/40 bg-success-soft/30 px-3 py-2 text-xs text-ink">
          {message}
        </p>
      )}
      {!publishedOnly && changed && (
        <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft/30 px-3 py-2 text-xs text-ink">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
          The working version has unsaved changes{base ? <> since <span className="font-mono">{base.label}</span></> : ''}.
          Save them as a version or discard them before you make another version the working version.
        </p>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="whitespace-nowrap border-b border-border text-left text-2xs font-semibold uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-semibold">Version</th>
              <th className="px-4 py-2.5 font-semibold">Based on</th>
              <th className="px-4 py-2.5 font-semibold">Actions</th>
              <th className="px-4 py-2.5 font-semibold">Changes</th>
              <th className="px-4 py-2.5 font-semibold">Saved by</th>
              <th className="px-4 py-2.5 font-semibold">When</th>
              <th className="px-4 py-2.5 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((v) => (
              <VersionRow
                key={v.id}
                projectId={projectId}
                version={v}
                live={base?.id === v.id}
                indent={!publishedOnly && v.publish_number === 0 && v.major > 0}
                previewing={previewing === v.id}
                onPreview={() => setPreviewing(previewing === v.id ? null : v.id)}
                onView={base?.id === v.id ? goToWorking : mayOpen ? () => setOpening(v) : undefined}
                onPublish={mayPublish && working.published?.id !== v.id ? () => setPublishing(v) : undefined}
                onAddNote={canSave ? () => setNoting(v) : undefined}
                onDelete={canSave && v.publish_number === 0 && base?.id !== v.id ? () => setDeleting(v) : undefined}
                mayDownload={mayDownload}
              />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto mb-3 w-fit text-faint">
              <StackPicture />
            </div>
            <p className="text-sm font-medium text-ink">{publishedOnly ? 'Nothing published yet' : 'No versions yet'}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">
              {publishedOnly
                ? 'Publishing a saved version makes it v1, v2… — the list everyone reads.'
                : 'Save the working version to keep it as it is now. Saves count up as v0.1, v0.2… and publishing one makes it v1, the list everyone reads.'}
            </p>
          </div>
        )}
      </Card>
      <p className="text-xs text-faint">
        <span className="font-medium text-muted">Live</span> marks the version the working version is based on.{' '}
        {mayOpen
          ? 'View opens a version as the working version.'
          : 'Editors and up can open a version as the working version.'}
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
      {noting && <VersionNoteDialog projectId={projectId} version={noting} onClose={() => setNoting(null)} />}
      {deleting && (
        <Dialog title={`Mark ${deleting.label} as deleted?`} onClose={() => setDeleting(null)}>
          <div className="space-y-2 p-4 text-sm text-muted">
            <p>
              <span className="font-mono text-ink">{deleting.label}</span> is hidden from the versions list. Its number
              is kept, so later saves do not reuse it.
            </p>
            {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleteVersion.isPending} onClick={confirmDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Mark as deleted
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

/** A dialog to add or edit a saved version's note. */
function VersionNoteDialog({
  projectId,
  version,
  onClose,
}: {
  projectId: number
  version: FeatureVersion
  onClose: () => void
}) {
  const setNote = useSetVersionNote(projectId)
  const [text, setText] = useState(versionNote(version))
  const [error, setError] = useState('')

  async function save() {
    setError('')
    try {
      await setNote.mutateAsync({ versionId: version.id, notes: text.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <Dialog title={`Notes for ${version.label}`} onClose={onClose}>
      <div className="space-y-3 p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          autoFocus
          placeholder="What this version is for, e.g. Ready for client review"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={setNote.isPending} onClick={save}>
          Save notes
        </Button>
      </div>
    </Dialog>
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
  onAddNote,
  onDelete,
  mayDownload,
}: {
  /** Owner and publishers may download the version as .md. */
  mayDownload: boolean
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
  /** Opens the note dialog for this version; missing without the right to edit. */
  onAddNote?: () => void
  /** Marks this version as deleted; missing when it cannot be deleted. */
  onDelete?: () => void
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
        <td className="px-4 py-3">
          <RowMenu
            label={`Actions for ${version.label}`}
            items={[
              ...(onView
                ? [
                    {
                      icon: <Eye className="h-3.5 w-3.5" />,
                      text: live ? 'Go to the working version' : 'Make this the working version',
                      onClick: onView,
                    },
                  ]
                : []),
              {
                icon: <GitCompare className="h-3.5 w-3.5" />,
                text: 'Compare with the working version',
                onClick: () => navigate({ name: 'compare', projectId, from: String(version.id), to: 'current' }),
              },
              ...(onAddNote
                ? [
                    {
                      icon: <Pencil className="h-3.5 w-3.5" />,
                      text: versionNote(version) ? 'Edit notes' : 'Add notes',
                      onClick: onAddNote,
                    },
                  ]
                : []),
              ...(onDelete
                ? [{ icon: <Trash2 className="h-3.5 w-3.5" />, text: 'Mark as deleted', onClick: onDelete }]
                : []),
              ...(onPublish
                ? [{ icon: <Send className="h-3.5 w-3.5" />, text: `Publish ${version.label}`, onClick: onPublish }]
                : []),
              {
                icon: <ListTree className="h-3.5 w-3.5" />,
                text: previewing ? 'Hide the list' : 'Look at the list',
                onClick: onPreview,
              },
              ...(mayDownload
                ? [
                    {
                      icon: downloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      ),
                      text: 'Download .md',
                      onClick: download,
                    },
                  ]
                : []),
            ]}
          />
        </td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
          {c ? (
            <Counts c={c} />
          ) : (
            <span className="font-sans text-muted">{plural(version.feature_count, 'feature')}</span>
          )}
        </td>
        <td className={cn('whitespace-nowrap px-4 py-3', published ? 'font-semibold text-ink' : 'text-muted')}>
          {version.saved_by.name || 'someone since removed'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-muted">{when(version.published_at ?? version.created_at)}</td>
        <td className="min-w-[16rem] max-w-sm px-4 py-3">
          <NoteEditor note={versionNote(version)} strong={published} />
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
const ROW_MENU_WIDTH = 224 // matches the w-56 the menu used to have

// The menu is drawn in a portal with fixed positioning, so it escapes the
// table's overflow box (overflow-x-auto clips it otherwise) and is never cut
// off at a row's edge.
function RowMenu({ label, items }: { label: string; items: { icon: ReactNode; text: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  function place() {
    const el = trigger.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ top: r.bottom + 4, left: Math.max(8, r.right - ROW_MENU_WIDTH) })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const t = event.target as Node
      if (trigger.current?.contains(t) || menu.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    const dismiss = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', dismiss)
    // Any ancestor scrolling (the table box included) would move the trigger.
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])

  return (
    <span ref={trigger} className="inline-flex">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) place()
          setOpen((v) => !v)
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ top: coords.top, left: coords.left, width: ROW_MENU_WIDTH }}
            className="fixed z-50 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-pop"
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
          </div>,
          document.body,
        )}
    </span>
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
            title={
              hasVersions
                ? 'Download a version, or upload a file you have edited'
                : 'Save a version first; copies are made from versions'
            }
            onClick={onStart}
          >
            <Upload className="h-3.5 w-3.5" />
            Start a copy or upload
          </Button>
        </div>
        <p className="mt-2 text-xs text-faint">Your copies are private to you.</p>
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
              <CopyRow
                key={copy.id}
                projectId={projectId}
                copy={copy}
                isNew={copy.id === done?.id}
                canMerge={canMerge}
              />
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
function EmptyScreen({
  picture,
  title,
  text,
  children,
}: {
  picture: ReactNode
  title: string
  text: string
  children: ReactNode
}) {
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
    <circle
      cx={cx}
      cy="34"
      r="20"
      className={active ? 'fill-accent-soft stroke-accent' : 'fill-raised stroke-border'}
      strokeWidth="1.5"
    />
  )
  return (
    <svg width="160" height="80" viewBox="0 0 160 80" fill="none">
      <path d="M44 34h12M104 34h12" className="stroke-border" strokeWidth="2" />
      <path d="M30 56 C 50 78, 110 78, 130 56" className="stroke-border" strokeWidth="1.5" strokeDasharray="3 4" />
      {circle(24, true)}
      {circle(80, false)}
      {circle(136, false)}
      <path
        d="M24 25v16m-6-6 6 6 6-6"
        className="stroke-accent"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M74 40l2-6 9-9 4 4-9 9-6 2z" className="stroke-muted" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M136 43V27m-6 6 6-6 6 6"
        className="stroke-muted"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
