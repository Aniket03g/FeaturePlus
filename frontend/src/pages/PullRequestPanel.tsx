import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Trash2,
  X,
} from 'lucide-react'
import {
  useDeletePullRequest,
  useMarkTested,
  usePullRequest,
  useReviewPullRequest,
} from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { REVIEW_LABEL } from '@/lib/types'

const DECISIONS = ['approved', 'changes_requested', 'rejected'] as const

/**
 * One pull request, in a side panel: what it is, whether it has passed the two
 * gates, and the controls to move it through them.
 *
 * The two gates are shown and changed separately on purpose. Tested is a fact
 * about the code and anyone can set it; approval is a person's decision and is
 * recorded with their name against it. A task is complete only when both hold,
 * so collapsing them into one control would hide which half is missing.
 */
export function PullRequestPanel({
  projectId,
  pullRequestId,
  onClose,
}: {
  projectId: number
  pullRequestId: number
  onClose: () => void
}) {
  const pr = usePullRequest(pullRequestId)
  const review = useReviewPullRequest(projectId, pullRequestId)
  const markTested = useMarkTested(projectId, pullRequestId)
  const remove = useDeletePullRequest(projectId)

  const [comment, setComment] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const data = pr.data

  async function decide(status: string) {
    setError('')
    try {
      await review.mutateAsync({ status, comment: comment.trim() || undefined })
      setComment('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the review')
    }
  }

  async function toggleTested() {
    setError('')
    try {
      await markTested.mutateAsync(!data?.tested)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the tested flag')
    }
  }

  async function handleDelete() {
    setError('')
    try {
      await remove.mutateAsync(pullRequestId)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the pull request')
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Pull request detail"
        className="flex h-full w-full max-w-lg animate-fade-in flex-col border-l border-border bg-surface shadow-pop"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0 text-faint" />
            <span className="truncate text-sm font-semibold text-ink">
              {data?.title ?? 'Pull request'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {pr.isLoading ? (
            <>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : pr.isError || !data ? (
            <div className="flex items-center gap-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
              <span className="text-muted">
                {pr.error instanceof ApiError ? pr.error.message : 'Could not load pull request'}
              </span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <a
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  {data.url}
                  <ExternalLink className="h-3 w-3" />
                </a>

                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-faint">Branch</dt>
                  <dd className="font-mono text-muted">{data.branch}</dd>
                  {data.feature_title && (
                    <>
                      <dt className="text-faint">Feature</dt>
                      <dd className="text-muted">{data.feature_title}</dd>
                    </>
                  )}
                  {data.task_name && (
                    <>
                      <dt className="text-faint">Task</dt>
                      <dd className="text-muted">{data.task_name}</dd>
                    </>
                  )}
                  {data.version && (
                    <>
                      <dt className="text-faint">Version</dt>
                      <dd className="font-mono text-muted">{data.version}</dd>
                    </>
                  )}
                </dl>
              </div>

              {data.description && (
                <p className="whitespace-pre-wrap rounded-md bg-raised px-3 py-2 text-sm text-muted">
                  {data.description}
                </p>
              )}

              <section className="space-y-2">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-faint">
                  Gates
                </h3>

                <Gate
                  met={data.tested}
                  icon={FlaskConical}
                  label={data.tested ? 'Tested' : 'Not tested yet'}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7"
                      onClick={toggleTested}
                      loading={markTested.isPending}
                    >
                      {data.tested ? 'Mark untested' : 'Mark tested'}
                    </Button>
                  }
                />

                <Gate
                  met={data.approved}
                  icon={CheckCircle2}
                  label={
                    data.approved
                      ? `Approved${
                          data.approvals?.[0]?.user
                            ? ` by ${data.approvals[0].user.username}`
                            : ''
                        }`
                      : `Awaiting review — ${data.status}`
                  }
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-faint">
                  Review
                </h3>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Optional note to record with the decision"
                  aria-label="Review comment"
                  className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                />

                <div className="flex flex-wrap gap-2">
                  {DECISIONS.map((decision) => (
                    <Button
                      key={decision}
                      size="sm"
                      variant={decision === 'approved' ? 'primary' : 'secondary'}
                      onClick={() => decide(decision)}
                      loading={review.isPending && review.variables?.status === decision}
                    >
                      {REVIEW_LABEL[decision]}
                    </Button>
                  ))}
                  {data.approved && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => decide('open')}
                      loading={review.isPending && review.variables?.status === 'open'}
                    >
                      {REVIEW_LABEL.open}
                    </Button>
                  )}
                </div>
              </section>

              {(data.approvals?.length ?? 0) > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-2xs font-semibold uppercase tracking-wider text-faint">
                    Approvals
                  </h3>
                  <ul className="space-y-1">
                    {data.approvals?.map((approval) => (
                      <li key={approval.id} className="flex items-center gap-2 text-xs">
                        <Badge tone="success">
                          {approval.user?.username ?? `User ${approval.user_id}`}
                        </Badge>
                        <span className="text-faint">
                          {new Date(approval.approved_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            loading={remove.isPending}
            disabled={!data}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </footer>
      </aside>
    </div>
  )
}

/** One of the two conditions a pull request has to satisfy. */
function Gate({
  met,
  icon: Icon,
  label,
  action,
}: {
  met: boolean
  icon: typeof CheckCircle2
  label: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
      <Icon className={cn('h-4 w-4 shrink-0', met ? 'text-success' : 'text-faint')} aria-hidden />
      <span className={cn('min-w-0 flex-1 truncate text-sm', met ? 'text-ink' : 'text-muted')}>
        {label}
      </span>
      {action}
    </div>
  )
}
