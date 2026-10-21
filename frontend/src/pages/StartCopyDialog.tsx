import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AlertCircle, Check, Download, FileText, Loader2, Upload } from 'lucide-react'
import { useCheckCopy, useSaveCopy, type CopyCheck, type FeatureCopy, type FeatureVersion, type SaveCopyRequest } from '@/lib/queries'
import { copyFileName, downloadCopyFile, downloadVersionFile, readCopyFile, versionFileName } from '@/lib/feature-file'
import { buildDiffTree } from '@/lib/compare-tree'
import { ApiError } from '@/lib/api'
import { Dialog } from '@/components/Dialog'
import { DiffTreeView } from '@/components/DiffTree'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, plural } from '@/lib/utils'

/** Why an upload was not taken: a file older than its copy, lines to fix, or a plain message. */
type Refusal =
  | { kind: 'stale'; message: string; copyId: number; copyName: string; uploadedAt: string }
  | { kind: 'lines'; problems: string[] }
  | { kind: 'message'; message: string }

/**
 * Starting a copy, and bringing an edited file back, in one place.
 *
 * 1 download a version, 2 edit it anywhere, 3 drop it here. The file is read
 * in the browser, then checked by the server without saving, which answers
 * with what the file changes. Only then is it saved: as a new private draft,
 * named here, or in place of the copy the file came from.
 */
export function StartCopyDialog({
  projectId,
  projectName,
  versions,
  onClose,
  onSaved,
}: {
  projectId: number
  projectName: string
  versions: FeatureVersion[]
  onClose: () => void
  onSaved: (copy: FeatureCopy) => void
}) {
  const [versionId, setVersionId] = useState(versions[0]?.id ?? 0)
  const [downloading, setDownloading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [request, setRequest] = useState<SaveCopyRequest | null>(null)
  const [check, setCheck] = useState<CopyCheck | null>(null)
  const [fileName, setFileName] = useState('')
  const [name, setName] = useState('')
  const [showChanges, setShowChanges] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const checking = useCheckCopy(projectId)
  const saving = useSaveCopy(projectId)

  const version = versions.find((v) => v.id === versionId)

  const tree = useMemo(
    () =>
      check?.comparison.from_list && check.comparison.to_list
        ? buildDiffTree(check.comparison.from_list, check.comparison.to_list)
        : null,
    [check],
  )
  const changeCount = check ? check.comparison.added + check.comparison.removed + check.comparison.changed : 0

  async function download() {
    if (!version) return
    setDownloading(true)
    try {
      await downloadVersionFile(projectId, version.id)
    } finally {
      setDownloading(false)
    }
  }

  function refuse(err: unknown) {
    if (err instanceof ApiError && err.fields.stale_copy_id) {
      setRefusal({
        kind: 'stale',
        message: err.message,
        copyId: Number(err.fields.stale_copy_id),
        copyName: err.fields.stale_copy_name ?? 'your copy',
        uploadedAt: err.fields.stale_uploaded_at ?? '',
      })
    } else {
      setRefusal({ kind: 'message', message: err instanceof ApiError ? err.message : 'Could not reach the server' })
    }
  }

  async function take(file: File) {
    setRefusal(null)
    setCheck(null)
    setRequest(null)
    setShowChanges(false)
    setFileName(file.name)

    const read = readCopyFile(await file.text(), projectId)
    if ('problems' in read) {
      setRefusal({ kind: 'lines', problems: read.problems })
      return
    }
    try {
      const answer = await checking.mutateAsync(read.request)
      setRequest(read.request)
      setCheck(answer)
      setName('')
    } catch (err) {
      refuse(err)
    }
  }

  async function save() {
    if (!request) return
    try {
      const copy = await saving.mutateAsync({ ...request, name: name.trim() })
      onSaved(copy)
    } catch (err) {
      setCheck(null)
      refuse(err)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void take(file)
  }

  const replacing = check?.replaces ?? null

  return (
    <Dialog title={check ? (replacing ? 'Replace your copy' : 'Save your copy') : 'Start a copy'} onClose={onClose} wide>
      <div className="space-y-4 p-4 sm:p-5">
        <div>
          <h3 className="text-base font-semibold text-ink">Suggest changes without touching the real list</h3>
          <p className="mt-0.5 text-xs text-muted">Your upload becomes a private draft. Nobody else sees it until you publish it.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* 1 · Download */}
          <Panel n={1} title="Download a version" active={!check && !refusal}>
            <label className="block text-2xs text-faint" htmlFor="start-copy-version">
              Start from
            </label>
            <select
              id="start-copy-version"
              className="h-8 w-full min-w-0 rounded-md border border-border bg-raised px-2 text-sm text-ink focus:border-accent focus:outline-none"
              value={versionId}
              onChange={(e) => setVersionId(Number(e.target.value))}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number} · {v.tag}
                </option>
              ))}
            </select>
            {version && (
              <p className="flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-2xs text-muted">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{versionFileName(projectName, version.number)}</span>
              </p>
            )}
            <Button size="sm" className="w-full gap-1.5" onClick={download} loading={downloading} disabled={!version}>
              <Download className="h-3.5 w-3.5" />
              Download .md
            </Button>
          </Panel>

          {/* 2 · Edit */}
          <Panel n={2} title="Edit it anywhere">
            <pre className="overflow-hidden rounded-md border border-border bg-raised/60 p-2 font-mono text-2xs leading-relaxed text-muted">
              <span className="text-faint">{'<!-- featureplus … keep -->'}</span>
              {'\n- Ordering\n  - Cart\n    needs: Menu browsing\n'}
              <span className="text-success">{'  - Promo codes\n'}</span>
              {'  - Checkout'}
            </pre>
            <p className="text-xs text-muted">
              Indent to nest. Retype to rename. Add a <code className="font-mono text-ink">needs:</code> line for dependencies.
              Keep the <code className="font-mono">{'<!-- -->'}</code> notes.
            </p>
          </Panel>

          {/* 3 · Upload */}
          <Panel n={3} title="Upload it here" active={Boolean(check || refusal)}>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex min-h-[8.5rem] flex-col items-center justify-center gap-2 rounded-md border border-dashed p-3 text-center transition-colors',
                dragging ? 'border-accent bg-accent-soft/40' : 'border-accent/40',
              )}
            >
              {checking.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              ) : (
                <Upload className="h-5 w-5 text-accent" />
              )}
              <p className="text-xs text-muted">{fileName && (check || refusal) ? fileName : 'Drop your .md file'}</p>
              <input
                ref={input}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  // Cleared so the same file, once fixed, can be picked again.
                  e.target.value = ''
                  if (file) void take(file)
                }}
              />
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={checking.isPending}>
                {fileName ? 'Choose another file' : 'Choose file'}
              </Button>
            </div>
          </Panel>
        </div>

        {/* After a refused file */}
        {refusal && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft/60 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {refusal.kind === 'stale'
                ? 'This file is older than your copy'
                : refusal.kind === 'lines'
                  ? 'This file needs fixing first'
                  : 'This file wasn’t saved'}
            </p>
            {refusal.kind === 'stale' && (
              <>
                <p className="mt-1 text-xs text-muted">
                  You uploaded “{refusal.copyName}” again
                  {refusal.uploadedAt &&
                    ` on ${new Date(refusal.uploadedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                  , after you downloaded this file. Uploading it now would undo that. Download the latest and make your edits there.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => downloadCopyFile(projectId, refusal.copyId)}>
                    <Download className="h-3.5 w-3.5" />
                    Download latest
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
                    Choose another file
                  </Button>
                </div>
              </>
            )}
            {refusal.kind === 'message' && <p className="mt-1 text-xs text-muted">{refusal.message}</p>}
            {refusal.kind === 'lines' && (
              <ul className="mt-2 space-y-1 border-t border-danger/20 pt-2">
                {refusal.problems.slice(0, 8).map((problem) => {
                  const line = /^Line (\d+): (.*)$/.exec(problem)
                  return (
                    <li key={problem} className="flex gap-3 text-xs text-ink">
                      {line && <span className="shrink-0 font-mono text-danger">line {line[1]}</span>}
                      <span>{line ? line[2] : problem}</span>
                    </li>
                  )
                })}
                {refusal.problems.length > 8 && (
                  <li className="text-xs text-muted">…and {plural(refusal.problems.length - 8, 'more problem')}.</li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* After a good file */}
        {check && (
          <div className="rounded-md border border-border bg-raised/30 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success-soft text-success sm:flex">
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  File read · {plural(check.comparison.to_list?.features.length ?? 0, 'feature')} ·{' '}
                  {changeCount === 0 ? `no changes from v${check.base.number} yet` : `${plural(changeCount, 'change')} from v${check.base.number}`}
                </p>
                {replacing ? (
                  <p className="mt-0.5 text-xs text-muted">
                    Replaces your copy “{replacing.name || `Copy ${replacing.number}`}”
                    {replacing.revision > 1 && ` (uploaded ${replacing.revision} times)`}.
                    <span className="block text-faint">
                      It downloads as {copyFileName(projectName, check.base.number, replacing)}
                    </span>
                  </p>
                ) : (
                  <div className="mt-1.5 max-w-sm">
                    <Input
                      label="Name your copy (optional)"
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Checkout rework"
                    />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {changeCount > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setShowChanges((v) => !v)} aria-expanded={showChanges}>
                    {showChanges ? 'Hide the changes' : `See the ${plural(changeCount, 'change')}`}
                  </Button>
                )}
                <Button size="sm" onClick={save} loading={saving.isPending}>
                  {replacing ? 'Replace copy' : 'Save as draft'}
                </Button>
              </div>
            </div>
            {showChanges && tree && (
              <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-border bg-surface p-2">
                <DiffTreeView tree={tree} onlyChanges />
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Panel({ n, title, active, children }: { n: number; title: string; active?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-lg border p-3', active ? 'border-accent/60 bg-accent-soft/20' : 'border-border')}>
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs',
            active ? 'bg-accent text-white' : 'bg-raised text-muted',
          )}
        >
          {n}
        </span>
        {title}
      </p>
      {children}
    </div>
  )
}
