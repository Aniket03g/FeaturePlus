import { useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  usePublishVersion,
  useRestorePreview,
  useRestoreVersion,
  useSaveVersion,
  type FeatureVersion,
} from '@/lib/queries'
import { useWorkingState, versionNote } from '@/lib/working'
import { ApiError } from '@/lib/api'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { plural } from '@/lib/utils'

/** Saves the Feature List as the next minor version, v2.3. The note is optional. */
export function SaveVersionDialog({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: number
  onClose: () => void
  onSaved?: (version: FeatureVersion) => void
}) {
  const save = useSaveVersion(projectId)
  const working = useWorkingState(projectId)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const saved = await save.mutateAsync({ notes: notes.trim() })
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <Dialog title={`Save as ${working.nextSave}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted">
            Keeps the Feature List as it is now as {working.nextSave}. You can publish it next, or keep working.
          </p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Input
            label="Note (optional)"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed, e.g. Collaboration split into two"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save as {working.nextSave}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * Publishes one saved version. The newest save becomes the next whole number
 * (v2.3 becomes v3); an older version is published as a new v3 with its list,
 * and keeps its own number.
 */
export function PublishDialog({
  projectId,
  version,
  onClose,
  onPublished,
}: {
  projectId: number
  version: FeatureVersion
  onClose: () => void
  /** Called with the published version's label, v3. */
  onPublished?: (label: string) => void
}) {
  const publish = usePublishVersion(projectId)
  const working = useWorkingState(projectId)
  const [notes, setNotes] = useState(versionNote(version))
  const [error, setError] = useState('')

  const newest = working.latest?.id === version.id && version.publish_number === 0
  const next = working.nextPublish
  const older = !newest

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const done = await publish.mutateAsync({ versionId: version.id, notes: notes.trim() })
      onPublished?.(done.label)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <Dialog title={`Publish ${version.label}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted">
            {newest ? (
              <>
                <span className="font-mono text-ink">{version.label}</span> will become{' '}
                <span className="font-mono text-ink">{next}</span>, the published list everyone on the project reads.
              </>
            ) : (
              <>
                The list as it was in <span className="font-mono text-ink">{version.label}</span> is published as{' '}
                <span className="font-mono text-ink">{next}</span>. {version.label} itself stays as it is in the list.
              </>
            )}
            {working.live ? ` It replaces ${working.live.label}, which stays in Versions.` : ''}
          </p>
          {older && working.live && (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              Everyone will see the list as it was in {version.label}, not the newest one. The Feature List itself does
              not change.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Input
            label="Note"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What this publish is, e.g. Ready for team review"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={publish.isPending}>
            Publish as {next}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const CHANGE_WORD: Record<string, string> = {
  added: 'Comes back',
  removed: 'Removed',
  renamed: 'Renamed',
  moved: 'Moved',
  needs_added: 'Needs added',
  needs_removed: 'Needs removed',
}

/**
 * Puts a saved version back as the Feature List. Shows what would change
 * first; refused while the list has changes not saved as a version.
 */
export function RestoreDialog({
  projectId,
  version,
  onClose,
  onDone,
}: {
  projectId: number
  version: FeatureVersion
  onClose: () => void
  onDone?: (savedLabel: string) => void
}) {
  const preview = useRestorePreview(projectId, version.id)
  const restore = useRestoreVersion(projectId)
  const [error, setError] = useState('')
  const p = preview.data

  async function go() {
    setError('')
    try {
      const result = await restore.mutateAsync(version.id)
      onDone?.(result.saved.label)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  const nothing = p && p.changes.length === 0 && p.described.length === 0

  return (
    <Dialog title={`Make ${version.label} the Feature List`} onClose={onClose} wide>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 text-xs">
        {preview.isLoading && <Skeleton className="h-24 w-full" />}
        {preview.isError && (
          <p className="text-danger">
            {preview.error instanceof ApiError ? preview.error.message : 'Could not work out the changes'}
          </p>
        )}
        {p && p.unsaved > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            The Feature List has {plural(p.unsaved, 'change')} since {p.latest}. Save them as a version first, so you
            can come back to them.
          </p>
        )}
        {p && p.unsaved === 0 && (
          <>
            <p className="text-muted">
              The Feature List's names, nesting, dependencies, descriptions and notes go back to how they were in{' '}
              <span className="font-mono text-ink">{version.label}</span>. Status, priority and tasks stay as they are.
              Afterwards the list is saved as a new version, so {p.latest} is still there if you change your mind.
            </p>
            {nothing && <p className="text-ink">The Feature List is already the same as {version.label}.</p>}
            {p.changes.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {p.changes.map((c, i) => (
                  <li key={`${c.key}-${c.kind}-${i}`} className="flex items-baseline gap-2 px-3 py-1.5">
                    <span className="w-24 shrink-0 text-2xs font-semibold uppercase tracking-wide text-faint">
                      {CHANGE_WORD[c.kind] ?? c.kind}
                    </span>
                    <span className="min-w-0 flex-1 text-ink">
                      {c.kind === 'renamed' ? (
                        <>
                          <span className="text-faint line-through">{c.from}</span> → {c.to}
                        </>
                      ) : c.kind === 'needs_added' || c.kind === 'needs_removed' ? (
                        <>
                          {c.title} needs {c.to || c.from}
                        </>
                      ) : (
                        c.title
                      )}
                    </span>
                    {c.path && <span className="truncate text-faint">{c.path}</span>}
                  </li>
                ))}
              </ul>
            )}
            {p.described.length > 0 && (
              <p className="text-muted">
                Description or notes go back for: <span className="text-ink">{p.described.join(', ')}</span>
              </p>
            )}
            {p.notes.length > 0 && (
              <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="font-medium text-ink">Kept, not removed</p>
                {p.notes.map((n, i) => (
                  <p key={i} className="text-muted">
                    <span className="text-ink">{n.title}</span>: {n.message}
                  </p>
                ))}
              </div>
            )}
            {p.problems.length > 0 && (
              <div className="space-y-1 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                {p.problems.map((m, i) => (
                  <p key={i}>{m}</p>
                ))}
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={go} loading={restore.isPending} disabled={!p?.ready || Boolean(nothing)}>
          Make {version.label} the Feature List
        </Button>
      </div>
    </Dialog>
  )
}
