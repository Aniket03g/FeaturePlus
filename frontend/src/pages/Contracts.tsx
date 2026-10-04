import { useState } from 'react'
import { AlertTriangle, ArrowLeft, Copy, FileCode, Lock, ShieldCheck } from 'lucide-react'
import { useContracts, useFileContent, useMock, useProject, useProjectFiles } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadFailure } from './LinkedCode'
import { cn } from '@/lib/utils'

/**
 * The contract view.
 *
 * What arrives here depends entirely on who is asking. A project owner reading
 * their own file gets the real source; a collaborator scoped to a dependency
 * gets a stripped contract and never the implementation; anyone else gets a
 * 404, because the existence of a file is itself not public. The screen states
 * which of those it is showing rather than leaving the reader to guess.
 */
export function Contracts({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const [path, setPath] = useState('')
  const [search, setSearch] = useState('')

  const project = useProject(projectId)
  const files = useProjectFiles(projectId, search)
  const contracts = useContracts(projectId)

  // Every file mapped in the project, marked with whether a contract has been
  // extracted for it — that is the difference between a file a collaborator
  // can be given and one that would answer "no contract available".
  const withContract = new Set((contracts.data?.items ?? []).map((c) => c.file_path))
  const items = files.data?.items ?? []

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
          <h2 className="text-base font-semibold text-ink">Contracts</h2>
          <p className="mt-0.5 text-sm text-muted">{project.data?.name}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-2">
            <CardTitle>Files</CardTitle>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter paths…"
              aria-label="Filter files"
              className="h-7 w-full rounded-md border border-border bg-bg px-2.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </CardHeader>
          <CardBody className="max-h-[60vh] overflow-y-auto p-1">
            {files.isLoading ? (
              <div className="space-y-1 p-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="p-3 text-xs text-muted">
                {search ? 'No paths match that filter.' : 'No files are mapped in this project yet.'}
              </p>
            ) : (
              <div className="space-y-0.5">
                {items.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => setPath(file.file_path)}
                    aria-current={path === file.file_path ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left font-mono text-xs transition-colors',
                      path === file.file_path
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    <FileCode className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.file_path}</span>
                    {withContract.has(file.file_path) && (
                      <ShieldCheck
                        className="h-3 w-3 shrink-0 text-success"
                        aria-label="A contract has been extracted"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {path ? (
          <FileViewer projectId={projectId} path={path} />
        ) : (
          <Card>
            <CardBody className="py-16 text-center">
              <FileCode className="mx-auto mb-2 h-5 w-5 text-faint" />
              <p className="text-sm text-muted">Pick a file to read it.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-faint">
                You will see the real source where you own the feature, and a stripped contract
                where you only depend on it.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}

function FileViewer({ projectId, path }: { projectId: number; path: string }) {
  const [showMock, setShowMock] = useState(false)

  const file = useFileContent(projectId, path)
  // A mock only exists for something you cannot see the source of, so it is
  // fetched only when the file came back as a contract.
  const mock = useMock(projectId, path, showMock && file.data?.is_source === false)

  const [copied, setCopied] = useState('')

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('')
    }
  }

  if (file.isLoading) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-64 w-full" />
        </CardBody>
      </Card>
    )
  }

  if (file.isError) {
    const notFound = file.error instanceof ApiError && file.error.code === 'not_found'
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-raised text-faint">
            <Lock className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-ink">
            {notFound ? 'You cannot read this file' : 'This file could not be read'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            {file.error instanceof ApiError
              ? notFound
                ? 'It is outside the features you have been granted access to.'
                : file.error.message
              : 'The server could not be reached.'}
          </p>
        </CardBody>
      </Card>
    )
  }

  const data = file.data
  if (!data) return null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="min-w-0 truncate font-mono">{data.file_path}</CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={data.is_source ? 'accent' : 'neutral'}>
              {data.is_source ? 'Real source' : 'Contract only'}
            </Badge>
            {data.commit && (
              <span className="font-mono text-2xs text-faint">{data.commit.slice(0, 8)}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => copy(data.content, 'file')}
            >
              <Copy className="h-3 w-3" />
              {copied === 'file' ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </CardHeader>

        {data.stale && (
          <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning-soft px-4 py-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-xs text-ink">
              This contract was extracted from an older version of the file. The real source has
              moved on, so what is below may no longer be true.
            </p>
          </div>
        )}

        {data.note && (
          <div className="border-b border-border bg-raised/50 px-4 py-2.5">
            <p className="text-2xs font-semibold uppercase tracking-wider text-faint">Behaviour</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{data.note}</p>
          </div>
        )}

        <CardBody className="p-0">
          <pre className="max-h-[60vh] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-ink">
            {data.content}
          </pre>
        </CardBody>
      </Card>

      {!data.is_source && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Mock</CardTitle>
            <Button variant="secondary" size="sm" className="h-7" onClick={() => setShowMock((v) => !v)}>
              {showMock ? 'Hide' : 'Generate a stand-in'}
            </Button>
          </CardHeader>
          {showMock && (
            <CardBody className="p-0">
              {mock.isLoading ? (
                <div className="p-4">
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : mock.isError ? (
                <LoadFailure error={mock.error} />
              ) : mock.data ? (
                <>
                  <div className="flex items-center justify-between border-b border-border px-4 py-2">
                    <span className="font-mono text-xs text-muted">{mock.data.mock_filename}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => copy(mock.data!.content, 'mock')}
                    >
                      <Copy className="h-3 w-3" />
                      {copied === 'mock' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <pre className="max-h-[40vh] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-ink">
                    {mock.data.content}
                  </pre>
                </>
              ) : null}
            </CardBody>
          )}
        </Card>
      )}
    </div>
  )
}
