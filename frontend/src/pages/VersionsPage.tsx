import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Download, GitCompare, History, Loader2, Plus, Upload } from 'lucide-react'
import {
  useCopies,
  useProject,
  useSetCopyPublished,
  useSaveVersion,
  useVersion,
  useVersionComparison,
  useVersions,
  type FeatureCopy,
  type FeatureVersion,
} from '@/lib/queries'
import { downloadCopyFile, downloadVersionFile } from '@/lib/feature-file'
import { Dialog } from '@/components/Dialog'
import { StartCopyDialog } from '@/pages/StartCopyDialog'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_LABEL, type FeatureStatus } from '@/lib/types'
import { cn, plural } from '@/lib/utils'

type Tab = 'versions' | 'copies'

/**
 * Saved versions of a project's feature list, and the copies people make of
 * them, on two tabs.
 *
 * Versions: save the list as it is now under a tag, read any version as a
 * tree, compare it with the list now or another version, and download it.
 * A saved version never changes. Anyone who can see the project can read them;
 * saving one needs the right to edit it.
 *
 * Copies: anyone who can see the project can download a version, edit the file
 * anywhere, and upload it back as their own copy. A copy is private until its
 * owner publishes it; published copies are listed for everyone, frozen, and an
 * owner or editor can merge one into the list.
 */
export function VersionsPage({ projectId, initialTab = 'versions' }: { projectId: number; initialTab?: Tab }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const versions = useVersions(projectId)
  const copies = useCopies(projectId)
  const canSave = project.data?.my_role !== undefined && project.data.my_role !== 'viewer'

  const [tab, setTab] = useState<Tab>(initialTab)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [justSaved, setJustSaved] = useState(0)
  const [justUploaded, setJustUploaded] = useState<{ id: number; message: string } | null>(null)

  const versionCount = versions.data?.length ?? 0
  const copyCount = copies.data?.length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-7 w-7 p-0"
          onClick={() => navigate({ name: 'project', projectId })}
          aria-label="Back to the project"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <History className="h-4 w-4 text-faint" />
            Versions
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {project.data?.name ? `${project.data.name} · ` : ''}
            {plural(versionCount, 'version')} · {plural(copyCount, 'copy', 'copies')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {versionCount > 0 && (
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setStarting(true)}>
              <Download className="h-3.5 w-3.5" />
              Start a copy
            </Button>
          )}
          {canSave && (
            <Button size="sm" className="gap-1.5" onClick={() => setSaving(true)}>
              <Plus className="h-3.5 w-3.5" />
              Save version
            </Button>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Versions or copies" className="inline-flex rounded-md border border-border bg-raised p-0.5">
        {(
          [
            ['versions', 'Versions', versionCount, <History key="v" className="h-3.5 w-3.5" />],
            ['copies', 'Copies', copyCount, <Copy key="c" className="h-3.5 w-3.5" />],
          ] as [Tab, string, number, ReactNode][]
        ).map(([id, label, count, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors',
              tab === id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {icon}
            {label}
            <span className="text-2xs text-faint">{count}</span>
          </button>
        ))}
      </div>

      {tab === 'versions' ? (
        <VersionsTab
          projectId={projectId}
          versions={versions}
          justSaved={justSaved}
          onSave={canSave ? () => setSaving(true) : undefined}
        />
      ) : (
        <CopiesTab
          projectId={projectId}
          canMerge={canSave}
          newest={versions.data?.[0]}
          onSaveVersion={canSave ? () => setSaving(true) : undefined}
          hasVersions={versionCount > 0}
          onStart={() => setStarting(true)}
          justUploaded={justUploaded}
        />
      )}

      {starting && (
        <StartCopyDialog
          projectId={projectId}
          projectName={project.data?.name ?? 'Features'}
          versions={versions.data ?? []}
          onClose={() => setStarting(false)}
          onSaved={(copy) => {
            setStarting(false)
            setTab('copies')
            setJustUploaded({
              id: copy.id,
              message:
                copy.revision === 1
                  ? `Saved as your draft${copy.name ? ` “${copy.name}”` : ` copy ${copy.number}`}, based on v${copy.base.number}. Publish it when it’s ready for review.`
                  : `${copy.name || `Copy ${copy.number}`} replaced with your new file.`,
            })
          }}
        />
      )}

      {saving && (
        <SaveVersionDialog
          projectId={projectId}
          nextNumber={(versions.data?.[0]?.number ?? 0) + 1}
          onClose={() => setSaving(false)}
          onSaved={(id) => {
            setSaving(false)
            setJustSaved(id)
            setTab('versions')
          }}
        />
      )}
    </div>
  )
}

// ---------- dialogs ----------

function SaveVersionDialog({
  projectId,
  nextNumber,
  onClose,
  onSaved,
}: {
  projectId: number
  /** The number the version will get, when known. */
  nextNumber?: number
  onClose: () => void
  onSaved: (id: number) => void
}) {
  const save = useSaveVersion(projectId)
  const [tag, setTag] = useState('')
  const [notes, setNotes] = useState('')
  const [tagError, setTagError] = useState('')
  const [error, setError] = useState('')

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setTagError('')
    setError('')
    if (!tag.trim()) {
      setTagError('Give the version a tag')
      return
    }
    try {
      const version = await save.mutateAsync({ tag: tag.trim(), notes: notes.trim() })
      onSaved(version.id)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields.tag) setTagError(err.fields.tag)
        else setError(err.message)
      } else {
        setError('Could not reach the server')
      }
    }
  }

  return (
    <Dialog title={nextNumber ? `Save as v${nextNumber}` : 'Save a version'} onClose={onClose}>
      <form onSubmit={handleSave} noValidate>
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted">Keeps the whole feature list as it is right now. A saved version never changes.</p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Input
            label="Tag"
            value={tag}
            maxLength={50}
            onChange={(e) => setTag(e.target.value)}
            error={tagError}
            placeholder="e.g. Agreed with client"
          />
          <Input
            label="Notes (optional)"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What this version is for"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save version
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

// ---------- versions tab ----------

function VersionsTab({
  projectId,
  versions,
  justSaved,
  onSave,
}: {
  projectId: number
  versions: ReturnType<typeof useVersions>
  justSaved: number
  onSave?: () => void
}) {
  const list = versions.data ?? []

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
  if (list.length === 0) {
    return (
      <EmptyScreen
        picture={<StackPicture />}
        title="No versions yet"
        text="A version is a saved snapshot of your feature list. Save one before a client meeting or a big change, and you can always compare back to it."
      >
        {onSave ? (
          <Button onClick={onSave}>Save the first version</Button>
        ) : (
          <p className="text-sm text-faint">Ask an editor or owner to save the first version.</p>
        )}
      </EmptyScreen>
    )
  }

  return (
    <div className="space-y-3">
      <LiveListCard projectId={projectId} newest={list[0]} onSave={onSave} />
      <Card>
        <ul className="divide-y divide-border">
          {groupAutoPairs(list).map((item) =>
            'pair' in item ? (
              <AutoPairRow key={item.pair[0].id} projectId={projectId} after={item.pair[0]} before={item.pair[1]} />
            ) : (
              <VersionRow key={item.version.id} projectId={projectId} version={item.version} isNew={item.version.id === justSaved} />
            ),
          )}
        </ul>
      </Card>
    </div>
  )
}

/**
 * Whether the server saved this version by itself around a merge. Versions
 * from before the auto mark existed are known by the notes the server wrote.
 */
function isAuto(version: FeatureVersion) {
  return (
    version.auto ||
    /^Saved automatically before copy \d+ was merged$/.test(version.notes) ||
    /^The list after copy \d+ was merged$/.test(version.notes)
  )
}

/** The copy number a merge's versions were saved around, from their tag. */
const mergedCopy = (version: FeatureVersion) => /copy (\d+)/i.exec(version.tag)?.[1]

/**
 * The list with each merge's two automatic versions, "Before merging copy N"
 * and "Merged copy N", side by side, taken together. Newest first, so the
 * "after" comes first.
 */
function groupAutoPairs(list: FeatureVersion[]): ({ version: FeatureVersion } | { pair: [FeatureVersion, FeatureVersion] })[] {
  const out: ({ version: FeatureVersion } | { pair: [FeatureVersion, FeatureVersion] })[] = []
  for (let i = 0; i < list.length; i++) {
    const after = list[i]
    const before = list[i + 1]
    if (
      before &&
      isAuto(after) &&
      isAuto(before) &&
      after.number === before.number + 1 &&
      mergedCopy(after) !== undefined &&
      mergedCopy(after) === mergedCopy(before)
    ) {
      out.push({ pair: [after, before] })
      i++
    } else {
      out.push({ version: after })
    }
  }
  return out
}

/** One merge's two automatic versions as a single quiet row that opens into both. */
function AutoPairRow({ projectId, after, before }: { projectId: number; after: FeatureVersion; before: FeatureVersion }) {
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const when = new Date(after.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Hide the two versions' : 'Show the two versions'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-faint">
          <span className="h-2 w-2 rounded-full border border-faint" aria-hidden />v{before.number} · v{after.number}
        </span>
        <button type="button" className="min-w-0 flex-1 basis-48 text-left text-sm text-muted hover:underline" onClick={() => setOpen((v) => !v)}>
          Saved automatically around merging copy {mergedCopy(after)}
        </button>
        <button
          type="button"
          className="shrink-0 text-xs text-accent hover:underline"
          onClick={() => navigate({ name: 'compare', projectId, from: String(before.id), to: String(after.id) })}
        >
          See what the merge changed
        </button>
        <span className="shrink-0 text-xs text-faint">{when}</span>
      </div>
      {open && (
        <ul className="divide-y divide-border border-t border-border bg-raised/20 pl-6">
          <VersionRow projectId={projectId} version={after} isNew={false} />
          <VersionRow projectId={projectId} version={before} isNew={false} />
        </ul>
      )}
    </li>
  )
}

/**
 * The list as it is now, against the newest version: has it moved on since
 * that was saved, and by how much? From here it can be compared in full or,
 * for owners and editors, saved as the next version.
 */
function LiveListCard({ projectId, newest, onSave }: { projectId: number; newest: FeatureVersion; onSave?: () => void }) {
  const { navigate } = useRouter()
  const since = useVersionComparison(projectId, newest.id, 'current')
  const data = since.data
  const changed = data ? data.added + data.removed + data.changed : 0
  const featuresNow = data ? newest.feature_count + data.added - data.removed : newest.feature_count

  return (
    <Card className={cn('px-4 py-3', changed > 0 ? 'border-accent/50 bg-accent-soft/20' : '')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="flex items-center gap-2 text-sm">
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-accent/30" />
              <span className="m-auto h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="font-medium text-ink">The list as it is now</span>
            <span className="text-xs text-muted">Live · {plural(featuresNow, 'feature')}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {since.isLoading ? (
              <Skeleton className="h-5 w-56" />
            ) : since.isError ? (
              <span>Could not check for changes since v{newest.number}.</span>
            ) : changed === 0 ? (
              <span>
                No changes since v{newest.number} {newest.tag}.
              </span>
            ) : (
              <>
                <span>Since v{newest.number}:</span>
                {data!.added > 0 && <Badge tone="success">+{data!.added} added</Badge>}
                {data!.removed > 0 && <Badge tone="danger">−{data!.removed} removed</Badge>}
                {data!.changed > 0 && <Badge tone="warning">{data!.changed} changed</Badge>}
              </>
            )}
          </div>
        </div>
        {changed > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate({ name: 'compare', projectId, from: String(newest.id), to: 'current' })}
            >
              See what changed
            </Button>
            {onSave && (
              <Button size="sm" onClick={onSave}>
                Save as v{newest.number + 1}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function VersionRow({ projectId, version, isNew }: { projectId: number; version: FeatureVersion; isNew: boolean }) {
  const { navigate } = useRouter()
  const [panel, setPanel] = useState<'tree' | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const toggle = (which: 'tree') => setPanel((now) => (now === which ? null : which))

  async function download() {
    setState('busy')
    try {
      await downloadVersionFile(projectId, version.id)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  const when = new Date(version.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <li className={cn(isNew && 'bg-accent-soft/40')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => toggle('tree')}
          aria-expanded={panel === 'tree'}
          aria-label={panel === 'tree' ? `Hide version ${version.number}` : `Show version ${version.number}`}
        >
          {panel === 'tree' ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <Badge tone="neutral" className="mt-0.5 shrink-0 font-mono">
          v{version.number}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className={cn('truncate text-left text-sm font-medium hover:underline', isAuto(version) ? 'text-muted' : 'text-ink')}
              onClick={() => toggle('tree')}
            >
              {version.tag}
            </button>
            {isAuto(version) && (
              <span className="shrink-0 text-2xs text-faint" title="Saved automatically around a merge">
                auto
              </span>
            )}
            {isNew && <Badge tone="accent">saved</Badge>}
          </div>
          <p className="text-xs text-muted">
            {version.saved_by.name || 'A removed account'} · {when} · {plural(version.feature_count, 'feature')}
          </p>
          {version.notes && !isAuto(version) && <p className="mt-0.5 break-words text-xs text-faint">{version.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => navigate({ name: 'compare', projectId, from: String(version.id), to: 'current' })}
            title="See what changed between this version and the list now, or another version"
          >
            <GitCompare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Compare</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', state === 'failed' && 'text-danger')}
            onClick={download}
            disabled={state === 'busy'}
            title="Download as .md, to read, or to edit and upload as your copy"
            aria-label={`Download version ${version.number}, ${version.tag}`}
          >
            {state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {state === 'failed' ? 'Failed' : '.md'}
          </Button>
        </div>
      </div>
      {panel === 'tree' && <VersionTree projectId={projectId} versionId={version.id} />}
    </li>
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
          Your copy is private until you publish it. {canMerge ? 'You' : 'An owner or editor'} can merge a published copy into
          the list.
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
      text="Want to suggest changes without touching the real list? Download a version, edit it in any text editor, and upload it here. It stays private until you publish it."
    >
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={download} loading={downloading} className="gap-1.5">
          <Download className="h-4 w-4" />
          Download v{newest.number} to start
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
  const publishing = useSetCopyPublished(projectId)
  const [publishError, setPublishError] = useState('')

  async function togglePublished() {
    setPublishError('')
    try {
      await publishing.mutateAsync({ copyId: copy.id, publish: !copy.published_at })
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

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
              title={`See what ${title} changes from v${copy.base.number}`}
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
            {copy.mine ? 'You' : copy.owner.name || 'A removed account'} · from v{copy.base.number}
            {copy.base.tag ? ` ${copy.base.tag}` : ''} · {when} · {plural(copy.feature_count, 'feature')}
            {copy.revision > 1 && ` · uploaded ${copy.revision} times`}
          </p>
          {publishError && (
            <p role="alert" className="mt-0.5 text-xs text-danger">
              {publishError}
            </p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={seeChanges}
            title={`See what ${title} changes from v${copy.base.number}, as a tree`}
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
          {copy.mine && !copy.merged_at && (
            <Button
              variant={copy.published_at ? 'ghost' : 'secondary'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              loading={publishing.isPending}
              onClick={togglePublished}
              title={
                copy.published_at
                  ? 'Make it private again, so you can upload changes to it'
                  : 'Share it with everyone on the project. It cannot change while published'
              }
            >
              {copy.published_at ? 'Unpublish' : 'Publish'}
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
