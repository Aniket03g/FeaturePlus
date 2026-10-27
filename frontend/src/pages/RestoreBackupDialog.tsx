import { useRef, useState, type DragEvent } from 'react'
import { AlertCircle, Archive, Check, Loader2, Upload, UserX } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { checkBackup, restoreBackup, type BackupCheck, type BackupCounts, type RestoreResult } from '@/lib/backup'
import { ApiError } from '@/lib/api'
import { ROLE_LABEL, type ProjectRole } from '@/lib/types'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/ui/button'
import { cn, plural } from '@/lib/utils'

/**
 * Restoring a backup: drop the file, see what is in it and what restoring
 * would do, then restore. The file is checked first and nothing is saved
 * until Restore is pressed. The result is always a new project, so nothing
 * that is already here can be lost.
 */
export function RestoreBackupDialog({
  onClose,
  onOpenProject,
}: {
  onClose: () => void
  onOpenProject: (projectId: number) => void
}) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<'checking' | 'restoring' | null>(null)
  const [check, setCheck] = useState<BackupCheck | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)

  function refuse(err: unknown) {
    setRefusal(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
  }

  async function take(chosen: File) {
    setFile(chosen)
    setCheck(null)
    setRefusal(null)
    setBusy('checking')
    try {
      setCheck(await checkBackup(chosen))
    } catch (err) {
      refuse(err)
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (!file) return
    setBusy('restoring')
    setRefusal(null)
    try {
      const restored = await restoreBackup(file)
      setResult(restored)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    } catch (err) {
      refuse(err)
    } finally {
      setBusy(null)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) void take(dropped)
  }

  if (result) {
    const { report } = result
    return (
      <Dialog title="Backup restored" onClose={onClose}>
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-3 rounded-md border border-success/30 bg-success-soft/60 p-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Restored as “{result.project_name}”</p>
              <p className="mt-0.5 text-xs text-muted">{countsLine(report.counts)}</p>
            </div>
          </div>
          <PeopleNotes report={report} done />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" onClick={() => onOpenProject(result.project_id)}>
              Open project
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title="Restore from backup" onClose={onClose}>
      <div className="space-y-4 p-4">
        <p className="text-xs text-muted">
          A backup becomes a <span className="font-medium text-ink">new project</span>, owned by you. Nothing you
          already have is changed.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors',
            check ? 'min-h-0' : 'min-h-[8.5rem]',
            dragging ? 'border-accent bg-accent-soft/40' : 'border-accent/40',
          )}
        >
          {busy === 'checking' ? (
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          ) : (
            <Upload className="h-5 w-5 text-accent" />
          )}
          <p className="max-w-full truncate text-xs text-muted">
            {busy === 'checking' ? 'Reading the backup…' : file ? file.name : 'Drop a backup file (.zip)'}
          </p>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0]
              // Cleared so the same file can be picked again.
              e.target.value = ''
              if (chosen) void take(chosen)
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy !== null}>
            {file ? 'Choose another file' : 'Choose file'}
          </Button>
        </div>

        {refusal && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft/60 p-3">
            <p className="flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{refusal}</span>
            </p>
          </div>
        )}

        {check && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-md border border-border bg-raised/30 p-3">
              <Archive className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  Backup of <span className="font-medium">{check.project_name}</span>, made {formatDate(check.made_on)}
                </p>
                <p className="mt-0.5 text-xs text-muted">{countsLine(check.counts)}</p>
                <p className="mt-2 text-xs text-muted">
                  It will be restored as <span className="font-medium text-ink">{check.restore_as}</span>.
                </p>
              </div>
            </div>

            <PeopleNotes report={check} />

            <ul className="space-y-1 text-2xs text-faint">
              <li>GitHub is not carried over. Connect it again in the new project if you need it.</li>
              {check.counts.copies + check.counts.versions > 0 && (
                <li>.md files downloaded from the old project cannot be uploaded into the restored one.</li>
              )}
            </ul>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy === 'restoring'}>
                Cancel
              </Button>
              <Button size="sm" onClick={restore} loading={busy === 'restoring'}>
                Restore as a new project
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** Who gets their role back, who is not on this server, and what is credited to you. */
function PeopleNotes({ report, done = false }: { report: BackupCheck; done?: boolean }) {
  const missingMembers = new Set(report.people.filter((p) => !p.found).map((p) => p.email.toLowerCase()))
  // People who only wrote things, rather than having the project shared with them.
  const otherMissing = report.missing.filter((email) => !missingMembers.has(email.toLowerCase()))

  if (report.people.length === 0 && report.missing.length === 0 && report.files_missing === 0) return null

  return (
    <div className="space-y-2">
      {report.people.length > 0 && (
        <div>
          <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-faint">Shared with</p>
          <ul className="space-y-1">
            {report.people.map((person) => (
              <li key={person.email} className="flex items-center gap-2 text-xs">
                {person.found ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <UserX className="h-3.5 w-3.5 shrink-0 text-warning" />
                )}
                <span className="min-w-0 truncate text-ink">{person.email}</span>
                <span className="shrink-0 text-muted">
                  {ROLE_LABEL[person.role as ProjectRole] ?? person.role}
                  {' · '}
                  {person.found
                    ? done
                      ? 'has their role back'
                      : 'gets their role back'
                    : done
                      ? 'skipped, no account here'
                      : 'will be skipped, no account here'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(otherMissing.length > 0 || report.credited_to_you > 0) && (
        <div className="rounded-md border border-warning/30 bg-warning-soft/50 p-2.5 text-xs text-ink">
          {otherMissing.length > 0 && (
            <p>
              {plural(otherMissing.length, 'person', 'people')} in the backup {otherMissing.length === 1 ? 'has' : 'have'}{' '}
              no account here: {otherMissing.join(', ')}.
            </p>
          )}
          {report.credited_to_you > 0 && (
            <p className={cn(otherMissing.length > 0 && 'mt-1')}>
              {plural(report.credited_to_you, 'thing')} they wrote {done ? 'now show' : 'will show'} as written by you.
            </p>
          )}
        </div>
      )}

      {report.files_missing > 0 && (
        <p className="text-xs text-warning">
          {plural(report.files_missing, 'attached file')} {report.files_missing === 1 ? 'was' : 'were'} already missing
          when the backup was made and cannot come back.
        </p>
      )}
    </div>
  )
}

const COUNT_WORDS: [keyof BackupCounts, string][] = [
  ['features', 'feature'],
  ['tasks', 'task'],
  ['comments', 'comment'],
  ['files', 'file'],
  ['versions', 'version'],
  ['copies', 'copy'],
  ['releases', 'release'],
  ['pull_requests', 'pull request'],
]

/** "42 features · 118 tasks · 6 files", leaving out what there is none of. */
function countsLine(counts: BackupCounts) {
  const parts = COUNT_WORDS.filter(([key]) => counts[key] > 0).map(([key, word]) =>
    plural(counts[key], word, word === 'copy' ? 'copies' : undefined),
  )
  return parts.length > 0 ? parts.join(' · ') : 'An empty project'
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'on an unknown date'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
