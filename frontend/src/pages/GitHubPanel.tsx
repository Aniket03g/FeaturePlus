import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, Github, RefreshCw, Unlink } from 'lucide-react'
import {
  githubConnectUrl,
  useDisconnectGitHub,
  useGitHubAccount,
  useGitHubLink,
  useGitHubRepos,
  useLinkGitHub,
  useSyncGitHub,
  useUnlinkGitHub,
} from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PLAN_FILE } from '@/lib/types'

/** What ?github= says after coming back from GitHub. */
const RETURN_NOTICE: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'GitHub connected.' },
  installed: { ok: true, text: 'Repositories updated on GitHub.' },
  cancelled: { ok: false, text: 'Connecting to GitHub was cancelled.' },
  expired: { ok: false, text: 'That GitHub sign-in had expired. Try connecting again.' },
  failed: { ok: false, text: 'GitHub sign-in did not go through. Try connecting again.' },
}

/**
 * Where the project's plan goes on GitHub.
 *
 * Three steps, each shown only when it is the next one: connect your GitHub
 * account, pick one of the repositories you gave FeaturePlus, then sync. The
 * copy only goes one way: FeaturePlus writes the plan file, as you, and an
 * edit made to it on GitHub is replaced on the next sync.
 */
/**
 * `canEdit` lets someone sync the plan; `canLink` lets them choose or drop the
 * repository, which is the owner's call alone.
 */
export function GitHubPanel({
  projectId,
  canEdit,
  canLink,
}: {
  projectId: number
  canEdit: boolean
  canLink: boolean
}) {
  const account = useGitHubAccount()
  const link = useGitHubLink(projectId)
  const connected = !!account.data?.connected

  const connectProject = useLinkGitHub(projectId)
  const unlinkProject = useUnlinkGitHub(projectId)
  const sync = useSyncGitHub(projectId)
  const disconnect = useDisconnectGitHub()

  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const linked = !!link.data?.linked
  const wantRepos = connected && canLink && (!linked || choosing)
  const repos = useGitHubRepos(wantRepos)

  // Read ?github= once after returning from GitHub, then take it off the
  // address so a reload does not repeat the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('github')
    if (!outcome) return
    const message = RETURN_NOTICE[outcome]
    if (message) {
      if (message.ok) setNotice(message.text)
      else setError(message.text)
    }
    params.delete('github')
    const rest = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  const here = window.location.pathname
  const connectHref = githubConnectUrl(here)
  const chooseReposHref = githubConnectUrl(here, true)

  function fail(err: unknown) {
    setNotice('')
    setError(err instanceof ApiError ? err.message : 'Could not reach the server')
  }

  async function handleSync() {
    setError('')
    try {
      const result = await sync.mutateAsync()
      setNotice(result.changed ? 'Plan written to GitHub.' : 'GitHub already has the latest plan. Nothing to commit.')
    } catch (err) {
      fail(err)
    }
  }

  async function handleUnlink() {
    setError('')
    try {
      await unlinkProject.mutateAsync()
      setNotice('This project no longer publishes to GitHub. Nothing on GitHub was changed.')
    } catch (err) {
      fail(err)
    }
  }

  async function handleDisconnect() {
    setError('')
    try {
      await disconnect.mutateAsync()
      setNotice('Your GitHub account is disconnected from FeaturePlus.')
    } catch (err) {
      fail(err)
    }
  }

  if (account.isLoading || link.isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-5 w-64" />
        </CardBody>
      </Card>
    )
  }

  const appReady = !!account.data?.app_configured
  const data = link.data

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-raised text-ink">
            <Github className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            {linked && data ? (
              <>
                <p className="text-sm font-medium text-ink">
                  Published to{' '}
                  <a href={data.repo_url} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                    {data.owner}/{data.repo}
                  </a>
                  <span className="font-normal text-muted"> on {data.branch}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {data.last_synced_at ? (
                    <>
                      Plan last written {formatWhen(data.last_synced_at)} ·{' '}
                      <a href={data.plan_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        view {PLAN_FILE}
                        <ExternalLink className="ml-0.5 inline h-3 w-3" />
                      </a>
                    </>
                  ) : (
                    'The plan has not been written to this repository yet.'
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-ink">Not on GitHub</p>
                <p className="mt-0.5 text-xs text-muted">
                  Copy this plan into one of your GitHub repositories as {PLAN_FILE}. Publishing a release then
                  also tags the repository and creates a GitHub Release.
                </p>
              </>
            )}
          </div>

          {linked && canEdit && connected && !choosing && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {canLink && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setChoosing(true)}>
                    Change
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUnlink}
                    loading={unlinkProject.isPending}
                    title="Stop publishing this project to GitHub. Nothing on GitHub is removed."
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    Stop publishing
                  </Button>
                </>
              )}
              <Button size="sm" onClick={handleSync} loading={sync.isPending}>
                <RefreshCw className="h-3.5 w-3.5" />
                Sync to GitHub
              </Button>
            </div>
          )}
        </div>

        {!appReady && (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-ink">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            GitHub is not set up on this server. The GitHub App settings are missing from its .env file.
          </p>
        )}

        {appReady && canEdit && !connected && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-raised px-3 py-2.5">
            <p className="min-w-0 flex-1 text-xs text-muted">
              {linked
                ? 'Connect your GitHub account to sync this plan and publish releases.'
                : 'First connect your GitHub account. You choose which repositories FeaturePlus can use.'}
            </p>
            <a
              href={connectHref}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-ink shadow-sm hover:bg-accent-hover"
            >
              <Github className="h-3.5 w-3.5" />
              Connect GitHub
            </a>
          </div>
        )}

        {wantRepos && (
          <RepoPicker
            loading={repos.isLoading}
            repos={repos.data ?? []}
            loadError={repos.isError ? (repos.error instanceof ApiError ? repos.error.message : 'Could not load your repositories') : ''}
            chooseReposHref={chooseReposHref}
            busy={connectProject.isPending}
            onCancel={linked ? () => setChoosing(false) : undefined}
            onPick={async (repo) => {
              setError('')
              try {
                await connectProject.mutateAsync({ repo })
                setChoosing(false)
                setNotice('Connected. Sync to write the plan file into the repository.')
              } catch (err) {
                fail(err)
              }
            }}
          />
        )}

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            {notice}
          </p>
        )}

        {connected && (
          <p className="border-t border-border pt-2 text-2xs text-faint">
            Signed in to GitHub as <span className="font-mono text-muted">@{account.data?.login}</span> ·{' '}
            <a href={chooseReposHref} className="hover:text-ink hover:underline">
              choose repositories
            </a>{' '}
            ·{' '}
            <button onClick={handleDisconnect} className="hover:text-ink hover:underline" disabled={disconnect.isPending}>
              disconnect
            </button>
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/** The repositories the person gave FeaturePlus, to pick one for this project. */
function RepoPicker({
  loading,
  repos,
  loadError,
  chooseReposHref,
  busy,
  onPick,
  onCancel,
}: {
  loading: boolean
  repos: { full_name: string; can_push: boolean }[]
  loadError: string
  chooseReposHref: string
  busy: boolean
  onPick: (repo: string) => void
  onCancel?: () => void
}) {
  const writable = repos.filter((repo) => repo.can_push)
  const [picked, setPicked] = useState('')

  useEffect(() => {
    if (!picked && writable.length > 0) setPicked(writable[0].full_name)
  }, [picked, writable])

  if (loading) return <Skeleton className="h-8 w-full" />
  if (loadError) return <p className="text-xs text-danger">{loadError}</p>

  if (writable.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-raised px-3 py-2.5">
        <p className="min-w-0 flex-1 text-xs text-muted">
          FeaturePlus has not been given any repositories you can write to yet.
        </p>
        <a href={chooseReposHref} className="text-xs font-medium text-accent hover:underline">
          Choose repositories on GitHub
        </a>
      </div>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (picked) onPick(picked)
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <select
        value={picked}
        onChange={(event) => setPicked(event.target.value)}
        aria-label="GitHub repository"
        className="h-8 min-w-[240px] flex-1 rounded-md border border-border bg-surface px-2 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        {writable.map((repo) => (
          <option key={repo.full_name} value={repo.full_name}>
            {repo.full_name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={!picked} loading={busy}>
        Publish here
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <a href={chooseReposHref} className="text-2xs text-faint hover:text-ink hover:underline">
        Not in the list?
      </a>
    </form>
  )
}

function formatWhen(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
