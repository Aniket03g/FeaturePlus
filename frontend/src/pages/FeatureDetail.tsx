import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, Check, Pencil, Trash2, X } from 'lucide-react'
import {
  useDeleteFeature,
  useFeature,
  useProject,
  useReplaceTags,
  useUpdateFeature,
} from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, PriorityPill, TagList } from '@/components/FeatureBits'
import { TaskList } from '@/components/TaskList'
import { FeatureAccess } from '@/components/FeatureAccess'
import { TaskPanel } from './TaskPanel'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type FeaturePriority,
  type FeatureStatus,
} from '@/lib/types'

/**
 * A single feature.
 *
 * Status and priority are changed in place from the header, because that is
 * the edit made most often and routing it through a form would be three clicks
 * for a one-field change. Title, description and tags open an editing state.
 */
export function FeatureDetail({
  projectId,
  featureId,
}: {
  projectId: number
  featureId: number
}) {
  const { navigate } = useRouter()
  const feature = useFeature(featureId)
  const project = useProject(projectId)
  const update = useUpdateFeature(projectId)
  const replaceTags = useReplaceTags(projectId)
  const remove = useDeleteFeature(projectId)

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagText, setTagText] = useState('')
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [openTaskId, setOpenTaskId] = useState(0)

  // Seed the editing fields whenever the loaded feature changes.
  useEffect(() => {
    if (feature.data) {
      setTitle(feature.data.title)
      setDescription(feature.data.description)
      setTagText(feature.data.tags.join(', '))
    }
  }, [feature.data])

  if (feature.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {feature.error instanceof ApiError ? feature.error.message : 'Could not load feature'}
          </span>
        </CardBody>
      </Card>
    )
  }

  if (feature.isLoading || !feature.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const data = feature.data
  const tasks = data.tasks

  async function saveEdits() {
    setError('')
    const tags = tagText.split(',').map((t) => t.trim()).filter(Boolean)

    try {
      await update.mutateAsync({ id: featureId, title, description })
      await replaceTags.mutateAsync({ id: featureId, tags })
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes')
    }
  }

  async function setStatus(status: FeatureStatus) {
    setError('')
    try {
      await update.mutateAsync({ id: featureId, status })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change status')
    }
  }

  async function setPriority(priority: FeaturePriority) {
    setError('')
    try {
      await update.mutateAsync({ id: featureId, priority })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change priority')
    }
  }

  async function handleDelete() {
    setError('')
    try {
      await remove.mutateAsync(featureId)
      navigate({ name: 'project', projectId })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this feature')
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => navigate({ name: 'project', projectId })}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {project.data?.name ?? 'Project'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      )}

      <Card>
        <CardBody className="space-y-4">
          {editing ? (
            <div className="space-y-3">
              <Input
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <div className="space-y-1.5">
                <label htmlFor="edit-description" className="block text-xs font-medium text-muted">
                  Description
                </label>
                <textarea
                  id="edit-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <Input
                label="Tags"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                hint="Separate with commas"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing(false)
                    setError('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveEdits}
                  loading={update.isPending || replaceTags.isPending}
                >
                  <Check className="h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight text-ink">{data.title}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    <StatusPill status={data.status} />
                    <PriorityPill priority={data.priority} />
                    {data.category && data.category !== 'general' && (
                      <Badge>{data.category}</Badge>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmingDelete(true)}
                    aria-label="Delete feature"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <p className="whitespace-pre-wrap text-sm text-muted">
                {data.description || 'No description.'}
              </p>

              {data.tags.length > 0 && <TagList tags={data.tags} max={12} />}
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <TaskList
            featureId={featureId}
            projectId={projectId}
            onOpenTask={setOpenTaskId}
          />

          {data.sub_features && data.sub_features.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Sub-features</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-border">
                  {data.sub_features.map((child) => (
                    <button
                      key={child.id}
                      onClick={() =>
                        navigate({ name: 'feature', projectId, featureId: child.id })
                      }
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {child.title}
                      </span>
                      <StatusPill status={child.status} />
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <FeatureAccess
            featureId={featureId}
            projectId={projectId}
            ownerId={project.data?.owner_id ?? 0}
          />

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1">
              {(Object.keys(STATUS_LABEL) as FeatureStatus[]).map((status) => (
                <QuickSet
                  key={status}
                  active={data.status === status}
                  onClick={() => setStatus(status)}
                >
                  {STATUS_LABEL[status]}
                </QuickSet>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Priority</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1">
              {(Object.keys(PRIORITY_LABEL) as FeaturePriority[]).map((priority) => (
                <QuickSet
                  key={priority}
                  active={data.priority === priority}
                  onClick={() => setPriority(priority)}
                >
                  {PRIORITY_LABEL[priority]}
                </QuickSet>
              ))}
            </CardBody>
          </Card>

          {tasks && tasks.total > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tasks</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Complete</span>
                  <span className="tabular-nums text-ink">
                    {tasks.completed} of {tasks.total}
                  </span>
                </div>
                <Progress
                  value={tasks.completed}
                  total={tasks.total}
                  tone={tasks.completed === tasks.total ? 'success' : 'accent'}
                  label="Task completion"
                />
                <p className="text-2xs text-faint">
                  A task counts as done once it has a tested, approved pull request.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {openTaskId > 0 && (
        <TaskPanel
          taskId={openTaskId}
          featureId={featureId}
          projectId={projectId}
          onClose={() => setOpenTaskId(0)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDelete
          title={data.title}
          pending={remove.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}

function QuickSet({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors',
        active
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {children}
      {active && <Check className="h-3.5 w-3.5" />}
    </button>
  )
}

function ConfirmDelete({
  title,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="w-full max-w-sm animate-fade-in rounded-lg border border-border bg-surface p-5 shadow-pop"
      >
        <h2 id="confirm-delete-title" className="text-sm font-semibold text-ink">
          Delete this feature?
        </h2>
        <p className="mt-1.5 text-xs text-muted">
          “{title}” will be removed. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={pending} onClick={onConfirm} autoFocus>
            <X className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
