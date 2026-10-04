import { useState, type FormEvent } from 'react'
import { Boxes, Download, Github, Trash2 } from 'lucide-react'
import {
  useDeleteImport,
  useImportFromGitHub,
  useImportProject,
  useImports,
} from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadFailure } from './LinkedCode'
import { plural } from '@/lib/utils'
import type { ImportSummary } from '@/lib/types'

/**
 * Starting a project from something that already exists: a GitHub repository
 * read live, or an analysis saved from an earlier read.
 *
 * The two are the same path. Analysing a repository produces a template and
 * saves it, and creating the project from that template is the same code that
 * runs for a saved analysis — so a repeat import is a re-run of the cheap half
 * rather than the whole thing.
 */
export function Imports() {
  const { navigate } = useRouter()
  const { user } = useAuth()

  const imports = useImports()
  const remove = useDeleteImport()

  const isManager = user?.role === 'manager'
  const items = imports.data?.items ?? []

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">Import a project</h2>
        <p className="mt-0.5 text-sm text-muted">
          Read a repository and turn what is in it into features and tasks.
        </p>
      </div>

      <GitHubImport onCreated={(projectId) => navigate({ name: 'project', projectId })} />

      <Card>
        <CardHeader>
          <CardTitle>
            Saved analyses
            {items.length > 0 && (
              <span className="ml-2 font-normal text-faint">{plural(items.length, 'analysis', 'analyses')}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {imports.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : imports.isError ? (
            <LoadFailure error={imports.error} onRetry={() => imports.refetch()} />
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Boxes className="mx-auto mb-2 h-5 w-5 text-faint" />
              <p className="text-sm text-muted">Nothing saved yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-faint">
                Analysing a repository above keeps its result here, so the same project can be
                created again without reading the repository a second time.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <SavedImport
                  key={item.id}
                  item={item}
                  canDelete={isManager}
                  onDelete={() => remove.mutate(item.id)}
                  onCreated={(projectId) => navigate({ name: 'project', projectId })}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function GitHubImport({ onCreated }: { onCreated: (projectId: number) => void }) {
  const importRepo = useImportFromGitHub()

  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setFormError('')

    try {
      const result = await importRepo.mutateAsync({
        repo_url: url.trim(),
        name: name.trim() || undefined,
      })
      onCreated(result.project_id)
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields)
        if (Object.keys(err.fields).length === 0) setFormError(err.message)
      } else {
        setFormError('Could not reach the server')
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-4 w-4" />
          From GitHub
        </CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {formError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Repository"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              error={fieldErrors.repo_url}
              placeholder="https://github.com/owner/repo"
              required
            />
            <Input
              label="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={fieldErrors.name}
              placeholder="Taken from the repository if left empty"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-2xs text-faint">
              The repository is read by a separate analyser process, which has to be running.
            </p>
            <Button type="submit" size="sm" loading={importRepo.isPending} disabled={!url.trim()}>
              <Download className="h-3.5 w-3.5" />
              {importRepo.isPending ? 'Analysing…' : 'Analyse and import'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function SavedImport({
  item,
  canDelete,
  onDelete,
  onCreated,
}: {
  item: ImportSummary
  canDelete: boolean
  onDelete: () => void
  onCreated: (projectId: number) => void
}) {
  const create = useImportProject()
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    try {
      const result = await create.mutateAsync({ import_id: item.id })
      onCreated(result.project_id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{item.name}</span>
          {item.tech_stack && <Badge tone="accent">{item.tech_stack}</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {plural(item.feature_count, 'feature')} · {plural(item.task_count, 'task')}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={submit} loading={create.isPending}>
          Create project
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onDelete}
            aria-label={`Delete the saved analysis ${item.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  )
}
