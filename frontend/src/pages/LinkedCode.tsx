import { useState, type FormEvent } from 'react'
import { AlertCircle, ArrowLeft, FileCode, GitCommitHorizontal, Plus, X } from 'lucide-react'
import {
  useFeatureCommits,
  useFeatureFiles,
  useFeatures,
  useLinkCommit,
  useLinkFile,
  useProject,
  useProjectFiles,
  useUnlinkCommit,
  useUnlinkFile,
} from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, plural } from '@/lib/utils'
import type { Feature } from '@/lib/types'

/**
 * The code map: which files and commits each feature is made of.
 *
 * This screen is quieter than it looks. A feature's file list is what a
 * contract gets extracted from and what an access grant is resolved against —
 * a feature with nothing mapped grants a collaborator nothing, however many
 * people are scoped to it. So the empty states here say that rather than just
 * looking blank.
 */
export function LinkedCode({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const [selected, setSelected] = useState(0)
  const [search, setSearch] = useState('')

  const project = useProject(projectId)
  const features = useFeatures(projectId, {})
  const allFiles = useProjectFiles(projectId, search)

  const items = features.data?.items ?? []
  const current = items.find((f) => f.id === selected) ?? items[0]

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
          {project.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <>
              <h2 className="text-base font-semibold text-ink">Linked code</h2>
              <p className="mt-0.5 text-sm text-muted">{project.data?.name}</p>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Features</CardTitle>
          </CardHeader>
          <CardBody className="p-1">
            {features.isLoading ? (
              <div className="space-y-1 p-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="p-3 text-xs text-muted">This project has no features yet.</p>
            ) : (
              <div className="space-y-0.5">
                {items.map((feature) => (
                  <FeatureButton
                    key={feature.id}
                    feature={feature}
                    active={current?.id === feature.id}
                    onClick={() => setSelected(feature.id)}
                  />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          {current ? (
            <>
              <FileList featureId={current.id} projectId={projectId} title={current.title} />
              <CommitList featureId={current.id} projectId={projectId} />
            </>
          ) : (
            <Card>
              <CardBody className="py-12 text-center">
                <FileCode className="mx-auto mb-2 h-5 w-5 text-faint" />
                <p className="text-sm text-muted">Pick a feature to see the code it maps to.</p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Everything mapped in this project</CardTitle>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter paths…"
                aria-label="Filter mapped files"
                className="h-7 w-44 rounded-md border border-border bg-bg px-2.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </CardHeader>
            <CardBody className="p-0">
              {(allFiles.data?.items.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted">
                  {search ? 'No paths match that filter.' : 'No files are mapped yet.'}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {allFiles.data?.items.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-2 px-4 py-2 font-mono text-xs text-muted"
                    >
                      <FileCode className="h-3 w-3 shrink-0 text-faint" />
                      <span className="truncate">{file.file_path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function FeatureButton({
  feature,
  active,
  onClick,
}: {
  feature: Feature
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors',
        active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {feature.title}
    </button>
  )
}

function FileList({
  featureId,
  projectId,
  title,
}: {
  featureId: number
  projectId: number
  title: string
}) {
  const files = useFeatureFiles(featureId)
  const link = useLinkFile(featureId, projectId)
  const unlink = useUnlinkFile(featureId, projectId)

  const [path, setPath] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await link.mutateAsync(path.trim())
      setPath('')
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.file_path ?? err.message) : 'Could not reach the server')
    }
  }

  const items = files.data?.items ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Files
          <span className="ml-2 font-normal text-faint">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <form onSubmit={submit} className="flex items-end gap-2" noValidate>
          <div className="flex-1">
            <Input
              label="Add a file"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="trails/search.go"
              error={error}
              hint="A path inside the repository"
              className="font-mono"
            />
          </div>
          <Button type="submit" size="sm" className="mb-6" loading={link.isPending} disabled={!path.trim()}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </form>

        {files.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
            <p className="text-xs text-muted">No files mapped to this feature.</p>
            <p className="mt-1 text-2xs text-faint">
              Until something is mapped here, a contract cannot be extracted and an access grant on
              this feature gives a collaborator nothing to read.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((file) => (
              <li key={file.id} className="flex items-center gap-2 px-3 py-2">
                <FileCode className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                  {file.file_path}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  onClick={() => unlink.mutate(file.id)}
                  aria-label={`Unmap ${file.file_path}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && <p className="text-2xs text-faint">{plural(items.length, 'file')}</p>}
      </CardBody>
    </Card>
  )
}

function CommitList({ featureId, projectId }: { featureId: number; projectId: number }) {
  const commits = useFeatureCommits(featureId)
  const link = useLinkCommit(featureId, projectId)
  const unlink = useUnlinkCommit(featureId, projectId)

  const [hash, setHash] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await link.mutateAsync(hash.trim())
      setHash('')
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.fields.commit_hash ?? err.message) : 'Could not reach the server',
      )
    }
  }

  const items = commits.data?.items ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commits</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <form onSubmit={submit} className="flex items-end gap-2" noValidate>
          <div className="flex-1">
            <Input
              label="Add a commit"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              placeholder="a1b2c3d"
              error={error}
              hint="7 to 40 hexadecimal characters"
              className="font-mono"
            />
          </div>
          <Button type="submit" size="sm" className="mb-6" loading={link.isPending} disabled={!hash.trim()}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </form>

        {commits.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted">
            No commits mapped to this feature.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((commit) => (
              <li key={commit.id} className="flex items-center gap-2 px-3 py-2">
                <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                  {commit.commit_hash.slice(0, 12)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  onClick={() => unlink.mutate(commit.id)}
                  aria-label={`Unmap ${commit.commit_hash}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** Shared by the contract screen, which reports the same failure shape. */
export function LoadFailure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-soft text-danger">
        <AlertCircle className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-ink">
        {error instanceof ApiError ? error.message : 'The server could not be reached'}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
