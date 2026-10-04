import { useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  GitPullRequest,
  ListChecks,
  Plus,
  Rocket,
  Trash2,
  X,
} from 'lucide-react'
import {
  useAssignFeatures,
  useDeleteRelease,
  useFeatures,
  githubConnectUrl,
  useGitHubAccount,
  useGitHubLink,
  usePublishRelease,
  usePublishReleaseToGitHub,
  usePullRequests,
  useRelease,
  useUnassignFeature,
  useUnlinkPullRequest,
  useLinkPullRequests,
  useUpdateRelease,
} from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/FeatureBits'
import { ReleaseStatusBadge } from './Releases'
import { cn, plural } from '@/lib/utils'
import type { Feature, PullRequest, Release } from '@/lib/types'

/**
 * One release: what is planned into it, what is delivering it, and whether it
 * can go out.
 *
 * Publishing here records the decision that a release is done. In a project
 * linked to GitHub it also tags the repository and creates a GitHub Release.
 * Branching and cherry-picking still belong to the older finalize route.
 */
export function ReleaseDetail({
  projectId,
  releaseId,
}: {
  projectId: number
  releaseId: number
}) {
  const { navigate } = useRouter()
  const release = useRelease(releaseId)

  const [addingFeatures, setAddingFeatures] = useState(false)
  const [addingPullRequests, setAddingPullRequests] = useState(false)
  const [actionError, setActionError] = useState('')
  // What publishing to GitHub said, when it failed. The release is still
  // published; the card below offers to try the GitHub step again.
  const [githubError, setGithubError] = useState('')
  // Set once Publish was pressed over warnings, until it is confirmed or cancelled.
  const [confirmingPublish, setConfirmingPublish] = useState(false)

  const publish = usePublishRelease(projectId, releaseId)
  const remove = useDeleteRelease(projectId)

  if (release.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {release.error instanceof ApiError ? release.error.message : 'Could not load release'}
          </span>
        </CardBody>
      </Card>
    )
  }

  if (release.isLoading || !release.data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const data = release.data

  // Only a draft can be re-planned or published. Discarding is allowed on
  // anything that never actually shipped — including one the older finalize
  // flow left as "failed", which is otherwise stuck on the list forever.
  const isDraft = data.status === 'draft'
  const canDiscard = data.status !== 'published'

  const warnings = data.readiness?.warnings ?? []

  async function handlePublish() {
    setActionError('')
    // Unfinished work does not block a publish, but it is asked about once.
    if (warnings.length > 0 && !confirmingPublish) {
      setConfirmingPublish(true)
      return
    }
    setConfirmingPublish(false)
    try {
      const published = await publish.mutateAsync()
      setGithubError(published.github_error ?? '')
    } catch (error) {
      // The blockers come back as per-field messages; joining them keeps the
      // API's own wording rather than inventing a summary here.
      if (error instanceof ApiError) {
        const blockers = Object.values(error.fields)
        setActionError(blockers.length > 0 ? blockers.join(' ') : error.message)
      } else {
        setActionError('Could not reach the server')
      }
    }
  }

  async function handleDelete() {
    setActionError('')
    try {
      await remove.mutateAsync(releaseId)
      navigate({ name: 'releases', projectId })
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : 'Could not reach the server',
      )
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-8 w-8 shrink-0 p-0"
          onClick={() => navigate({ name: 'releases', projectId })}
          aria-label="Back to releases"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-mono text-base font-semibold text-ink">{data.tag}</h2>
            <ReleaseStatusBadge status={data.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {plural(data.features.total, 'feature')} · {plural(data.pull_requests.total, 'pull request')}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {canDiscard && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDelete}
              loading={remove.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Discard
            </Button>
          )}
          {isDraft && (
            <Button
              size="sm"
              onClick={handlePublish}
              loading={publish.isPending}
              disabled={!data.readiness?.ready || confirmingPublish}
              title={
                data.readiness?.ready
                  ? 'Mark this release as shipped'
                  : 'Something is stopping this release from going out'
              }
            >
              <Rocket className="h-3.5 w-3.5" />
              Publish
            </Button>
          )}
        </div>
      </div>

      {confirmingPublish && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-xs text-ink">
            {warnings.join(' ')} Publish anyway?
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmingPublish(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handlePublish} loading={publish.isPending}>
              <Rocket className="h-3.5 w-3.5" />
              Publish anyway
            </Button>
          </div>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {actionError}
        </div>
      )}

      <ReadinessCard release={data} />

      <GitHubReleaseCard projectId={projectId} release={data} failure={githubError} onFailure={setGithubError} />

      <NotesCard projectId={projectId} release={data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PlannedFeatures
          projectId={projectId}
          release={data}
          onOpenFeature={(featureId) => navigate({ name: 'feature', projectId, featureId })}
          onAdd={() => setAddingFeatures(true)}
        />
        <LinkedPullRequests
          projectId={projectId}
          release={data}
          onAdd={() => setAddingPullRequests(true)}
        />
      </div>

      {addingFeatures && (
        <AddFeaturesDialog
          projectId={projectId}
          release={data}
          onClose={() => setAddingFeatures(false)}
        />
      )}
      {addingPullRequests && (
        <AddPullRequestsDialog
          projectId={projectId}
          release={data}
          onClose={() => setAddingPullRequests(false)}
        />
      )}
    </div>
  )
}

/**
 * The release on GitHub, in a project linked to a repository: where it will go
 * before publishing, the GitHub Release after, and a retry when that failed.
 */
function GitHubReleaseCard({
  projectId,
  release,
  failure,
  onFailure,
}: {
  projectId: number
  release: Release
  failure: string
  onFailure: (message: string) => void
}) {
  const link = useGitHubLink(projectId)
  const account = useGitHubAccount()
  const retry = usePublishReleaseToGitHub(projectId, release.id)
  const connected = !!account.data?.connected

  if (!link.data?.linked) return null
  const repoName = `${link.data.owner}/${link.data.repo}`

  async function handleRetry() {
    onFailure('')
    try {
      await retry.mutateAsync()
    } catch (error) {
      onFailure(error instanceof ApiError ? error.message : 'Could not reach the server')
    }
  }

  let body
  if (release.github_url) {
    body = (
      <>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        <p className="min-w-0 flex-1 text-sm text-ink">
          On GitHub as{' '}
          <a href={release.github_url} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
            {repoName} {release.tag}
            <ExternalLink className="ml-0.5 inline h-3 w-3" />
          </a>
        </p>
      </>
    )
  } else if (release.status === 'published') {
    body = (
      <>
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">Published here, but not on GitHub yet.</p>
          {failure && <p className="mt-0.5 text-xs text-danger">{failure}</p>}
        </div>
        {connected ? (
          <Button size="sm" variant="secondary" onClick={handleRetry} loading={retry.isPending}>
            Publish to GitHub
          </Button>
        ) : (
          <a
            href={githubConnectUrl(window.location.pathname)}
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-raised"
          >
            Connect GitHub
          </a>
        )}
      </>
    )
  } else if (release.status === 'draft') {
    body = (
      <p className="text-xs text-muted">
        Publishing also tags <span className="font-mono text-ink">{repoName}</span> as{' '}
        <span className="font-mono text-ink">{release.tag}</span> and creates a GitHub Release listing its features
        {connected ? ', as you' : ''}.
        {!connected && (
          <>
            {' '}
            <a href={githubConnectUrl(window.location.pathname)} className="text-accent hover:underline">
              Connect GitHub
            </a>{' '}
            first, or it will be published here only.
          </>
        )}
      </p>
    )
  } else {
    return null
  }

  return (
    <Card>
      <CardBody className="flex items-center gap-3 py-3">{body}</CardBody>
    </Card>
  )
}

/** Whether the release can go out, in the API's own words. */
function ReadinessCard({ release }: { release: Release }) {
  const readiness = release.readiness
  if (!readiness) return null

  const warnings = readiness.warnings ?? []

  if (readiness.ready && warnings.length > 0 && release.status !== 'published') {
    return (
      <Card className="border-warning/40">
        <CardBody className="py-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Can be published, but not everything is finished</p>
              <ul className="mt-1 space-y-0.5">
                {warnings.map((warning) => (
                  <li key={warning} className="text-xs text-muted">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  if (readiness.ready) {
    return (
      <Card className="border-success/40">
        <CardBody className="flex items-center gap-3 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <p className="text-sm text-ink">
            Everything in this release is finished. It is ready to publish.
          </p>
        </CardBody>
      </Card>
    )
  }

  // A published release has nothing outstanding to report. Anything else —
  // including one the finalize flow left as "failed" — gets the explanation.
  if (release.status === 'published') return null

  return (
    <Card className="border-warning/40">
      <CardBody className="py-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Not ready to publish</p>
            <ul className="mt-1 space-y-0.5">
              {readiness.blockers.map((blocker) => (
                <li key={blocker} className="text-xs text-muted">
                  {blocker}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

/** Release notes, editable in place. */
function NotesCard({ projectId, release }: { projectId: number; release: Release }) {
  const update = useUpdateRelease(projectId, release.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(release.notes)

  async function save() {
    await update.mutateAsync({ notes: draft })
    setEditing(false)
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Notes</CardTitle>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              setDraft(release.notes)
              setEditing(true)
            }}
          >
            Edit
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              aria-label="Release notes"
              className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} loading={update.isPending}>
                Save
              </Button>
            </div>
          </div>
        ) : release.notes ? (
          <p className="whitespace-pre-wrap text-sm text-muted">{release.notes}</p>
        ) : (
          <p className="text-sm text-faint">No notes yet.</p>
        )}
      </CardBody>
    </Card>
  )
}

function PlannedFeatures({
  projectId,
  release,
  onOpenFeature,
  onAdd,
}: {
  projectId: number
  release: Release
  onOpenFeature: (featureId: number) => void
  onAdd: () => void
}) {
  const unassign = useUnassignFeature(projectId, release.id)
  const features = release.planned_features ?? []
  const isDraft = release.status === 'draft'

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>
          Planned features
          <span className="ml-2 font-normal text-faint">
            {release.features.done}/{release.features.total} done
          </span>
        </CardTitle>
        {isDraft && (
          <Button variant="ghost" size="sm" className="h-7" onClick={onAdd}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardBody className="p-0">
        {features.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <ListChecks className="mx-auto mb-2 h-5 w-5 text-faint" />
            <p className="text-xs text-muted">Nothing planned into this release yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {features.map((feature) => (
              <li key={feature.id} className="flex items-center gap-3 px-4 py-2.5">
                <button
                  onClick={() => onOpenFeature(feature.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm text-ink hover:underline">
                    {feature.title}
                  </span>
                </button>
                <StatusPill status={feature.status} />
                {isDraft && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0"
                    onClick={() => unassign.mutate(feature.id)}
                    aria-label={`Remove ${feature.title} from this release`}
                    title="Remove from this release"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function LinkedPullRequests({
  projectId,
  release,
  onAdd,
}: {
  projectId: number
  release: Release
  onAdd: () => void
}) {
  const unlink = useUnlinkPullRequest(projectId, release.id)
  const prs = release.linked_pull_requests ?? []
  const isDraft = release.status === 'draft'

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>
          Pull requests
          <span className="ml-2 font-normal text-faint">
            {release.pull_requests.done}/{release.pull_requests.total} ready
          </span>
        </CardTitle>
        {isDraft && (
          <Button variant="ghost" size="sm" className="h-7" onClick={onAdd}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardBody className="p-0">
        {prs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <GitPullRequest className="mx-auto mb-2 h-5 w-5 text-faint" />
            <p className="text-xs text-muted">No pull requests linked to this release.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {prs.map((pr) => (
              <li key={pr.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-ink">{pr.title}</span>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-faint hover:text-accent"
                      aria-label={`Open ${pr.title} in a new tab`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {pr.task_name && (
                    <p className="truncate text-2xs text-faint">{pr.task_name}</p>
                  )}
                </div>
                <PullRequestState pr={pr} />
                {isDraft && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0"
                    onClick={() => unlink.mutate(pr.id)}
                    aria-label={`Remove ${pr.title} from this release`}
                    title="Remove from this release"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * The two gates a pull request has to pass, shown as two marks rather than one
 * combined word, because "not ready" without saying which half is missing
 * leaves the reader to go and find out.
 */
export function PullRequestState({ pr }: { pr: PullRequest }) {
  return (
    <div className="flex shrink-0 gap-1">
      <Badge tone={pr.tested ? 'success' : 'neutral'} title={pr.tested ? 'Tested' : 'Not tested'}>
        {pr.tested ? 'Tested' : 'Untested'}
      </Badge>
      <Badge
        tone={pr.approved ? 'success' : pr.status.toLowerCase() === 'rejected' ? 'danger' : 'warning'}
      >
        {pr.status}
      </Badge>
    </div>
  )
}

/** Pick features to add to a release. */
function AddFeaturesDialog({
  projectId,
  release,
  onClose,
}: {
  projectId: number
  release: Release
  onClose: () => void
}) {
  const features = useFeatures(projectId, {})
  const assign = useAssignFeatures(projectId, release.id)
  const [picked, setPicked] = useState<number[]>([])
  const [error, setError] = useState('')

  const alreadyIn = new Set((release.planned_features ?? []).map((f) => f.id))
  const candidates = (features.data?.items ?? []).filter((f) => !alreadyIn.has(f.id))

  async function submit() {
    setError('')
    try {
      await assign.mutateAsync(picked)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <PickerDialog
      title="Add features to this release"
      empty="Every feature in this project is already in this release."
      items={candidates.map((feature: Feature) => ({
        id: feature.id,
        label: feature.title,
        note: feature.release_id !== null && feature.release_id !== release.id ? 'moves' : '',
      }))}
      picked={picked}
      onToggle={(id) =>
        setPicked((current) =>
          current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
        )
      }
      loading={features.isLoading}
      submitting={assign.isPending}
      error={error}
      onSubmit={submit}
      onClose={onClose}
    />
  )
}

/** Pick pull requests to link to a release. */
function AddPullRequestsDialog({
  projectId,
  release,
  onClose,
}: {
  projectId: number
  release: Release
  onClose: () => void
}) {
  const prs = usePullRequests(projectId, {})
  const link = useLinkPullRequests(projectId, release.id)
  const [picked, setPicked] = useState<number[]>([])
  const [error, setError] = useState('')

  const alreadyIn = new Set((release.linked_pull_requests ?? []).map((p) => p.id))
  const candidates = (prs.data?.items ?? []).filter((p) => !alreadyIn.has(p.id))

  async function submit() {
    setError('')
    try {
      await link.mutateAsync(picked)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <PickerDialog
      title="Add pull requests to this release"
      empty="Every pull request in this project is already in this release."
      items={candidates.map((pr) => ({
        id: pr.id,
        label: pr.title,
        note: pr.tested && pr.approved ? 'ready' : pr.status,
      }))}
      picked={picked}
      onToggle={(id) =>
        setPicked((current) =>
          current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
        )
      }
      loading={prs.isLoading}
      submitting={link.isPending}
      error={error}
      onSubmit={submit}
      onClose={onClose}
    />
  )
}

/**
 * A multi-select dialog. Both pickers on this screen do the same thing to
 * different lists, so the list is the parameter and the shell is written once.
 */
function PickerDialog({
  title,
  empty,
  items,
  picked,
  onToggle,
  loading,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  empty: string
  items: { id: number; label: string; note?: string }[]
  picked: number[]
  onToggle: (id: number) => void
  loading: boolean
  submitting: boolean
  error: string
  onSubmit: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[80vh] w-full max-w-md flex-col animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-2 text-xs text-faint">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-2 text-xs text-muted">{empty}</p>
          ) : (
            <div className="space-y-0.5">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggle(item.id)}
                  aria-pressed={picked.includes(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    picked.includes(item.id)
                      ? 'bg-accent-soft text-accent'
                      : 'text-muted hover:bg-raised hover:text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.note && <span className="shrink-0 text-2xs text-faint">{item.note}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="px-4 pb-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border p-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} loading={submitting} disabled={picked.length === 0}>
            Add {picked.length > 0 ? picked.length : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
