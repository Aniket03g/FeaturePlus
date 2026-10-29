import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  useCreateFeature,
  useDeleteFeature,
  useFeature,
  useFeatureAttachments,
  useFeatures,
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
import { Markdown } from '@/components/Markdown'
import { ColorDot } from '@/components/FeatureColor'
import { FeatureFiles, MarkdownEditor, paragraphBreak } from '@/components/MarkdownEditor'
import { TaskPanel } from './TaskPanel'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type FeaturePriority,
  type Feature,
  type FeatureStatus,
} from '@/lib/types'

/** The parts of a feature that are edited one at a time. */
type EditPart = 'title' | 'description' | 'notes' | 'tags'

/** Cancel and Save for whichever part is being edited. */
function EditButtons({ onCancel, onSave, saving }: { onCancel: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" onClick={onSave} loading={saving}>
        <Check className="h-3.5 w-3.5" />
        Save
      </Button>
    </div>
  )
}

/** A small heading over the description or notes, with its Edit button. */
function PartHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-1.5 flex h-6 items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">{title}</h3>
      {children}
    </div>
  )
}

/** No filters: the same key the project's feature list uses, so both share one request. */
const ALL_FEATURES = { status: [], tag: '', q: '' }

/** Indent per level in the sub-features box, in pixels, as in the feature list. */
const SUB_INDENT = 20

interface SubRow {
  feature: Feature
  /** Levels below the open feature, starting at 0 for its direct children. */
  depth: number
  /** The level the feature list shows: L0 at the top of the project. */
  level: number
  parts: { done: number; total: number }
}

/**
 * Every feature below `rootId`, in reading order: each one followed by what is
 * inside it. A feature caught in a loop of parents is listed once.
 */
function descendants(all: Feature[], rootId: number): { rows: SubRow[]; rootLevel: number } {
  const byId = new Map(all.map((f) => [f.id, f]))
  const kids = new Map<number, Feature[]>()
  for (const f of all) {
    if (f.parent_feature_id == null) continue
    kids.set(f.parent_feature_id, [...(kids.get(f.parent_feature_id) ?? []), f])
  }

  // The open feature's own level: how many parents it has.
  let rootLevel = 0
  const climbed = new Set<number>([rootId])
  let parent = byId.get(rootId)?.parent_feature_id ?? null
  while (parent != null && byId.has(parent) && !climbed.has(parent)) {
    climbed.add(parent)
    rootLevel += 1
    parent = byId.get(parent)?.parent_feature_id ?? null
  }

  const rows: SubRow[] = []
  const seen = new Set<number>([rootId])
  const walk = (id: number, depth: number) => {
    for (const child of kids.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      const inside = kids.get(child.id) ?? []
      rows.push({
        feature: child,
        depth,
        level: rootLevel + 1 + depth,
        parts: {
          done: inside.filter((f) => f.status === 'done').length,
          total: inside.length,
        },
      })
      walk(child.id, depth + 1)
    }
  }
  walk(rootId, 0)
  return { rows, rootLevel }
}

/**
 * A single feature.
 *
 * Status and priority are changed in place from the header, because that is
 * the edit made most often and routing it through a form would be three clicks
 * for a one-field change. Title, description, notes and tags each have their
 * own Edit and Save, so changing one never means scrolling past the others.
 *
 * Opened from the published list it is read-only; from the Working list,
 * editable.
 */
export function FeatureDetail({
  projectId,
  featureId,
  editable,
}: {
  projectId: number
  featureId: number
  editable: boolean
}) {
  const { navigate } = useRouter()
  const feature = useFeature(featureId)
  const project = useProject(projectId)
  // The same query as the project's feature list, so it is usually cached.
  const allFeatures = useFeatures(projectId, ALL_FEATURES)
  const update = useUpdateFeature(projectId)
  const replaceTags = useReplaceTags(projectId)
  const remove = useDeleteFeature(projectId)
  const attachmentList = useFeatureAttachments(featureId)
  const attachments = attachmentList.data?.items ?? []

  // Which part is open for editing; one at a time.
  const [editing, setEditing] = useState<EditPart | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [tagText, setTagText] = useState('')
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [openTaskId, setOpenTaskId] = useState(0)
  // The feature the add box is open under: this one, one in the tree, or none.
  const [addingUnder, setAddingUnder] = useState<number | null>(null)

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
  // Everything below this feature, nested. Until the project's list arrives,
  // the direct children the feature came with are shown flat.
  const tree = allFeatures.data ? descendants(allFeatures.data.items, featureId) : null
  const subRows: SubRow[] =
    tree?.rows ??
    (data.sub_features ?? []).map((f) => ({
      feature: f,
      depth: 0,
      level: 1,
      parts: { done: 0, total: 0 },
    }))
  // Unknown until the project's list arrives; the add box then shows no level.
  const ownLevel = tree?.rootLevel ?? null
  // Until the role is known, show the add box rather than flicker it in.
  const canEdit = editable && project.data?.my_role !== 'viewer'

  /** Opens one part for editing, starting from what is saved. */
  function startEditing(part: EditPart) {
    setError('')
    setTitle(data.title)
    setDescription(data.description)
    setNotes(data.notes ?? '')
    setTagText(data.tags.join(', '))
    setEditing(part)
  }

  function cancelEditing() {
    setEditing(null)
    setError('')
  }

  async function saveEdit() {
    setError('')
    try {
      if (editing === 'tags') {
        const tags = tagText.split(',').map((t) => t.trim()).filter(Boolean)
        await replaceTags.mutateAsync({ id: featureId, tags })
      } else if (editing === 'title') {
        await update.mutateAsync({ id: featureId, title })
      } else if (editing === 'description') {
        await update.mutateAsync({ id: featureId, description })
      } else if (editing === 'notes') {
        await update.mutateAsync({ id: featureId, notes })
      }
      setEditing(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes')
    }
  }

  const saving = update.isPending || replaceTags.isPending
  const editButtons = <EditButtons onCancel={cancelEditing} onSave={saveEdit} saving={saving} />
  const editLink = (part: EditPart, label: string) =>
    canEdit && editing === null ? (
      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => startEditing(part)} aria-label={label}>
        <Pencil className="h-3 w-3" />
        Edit
      </Button>
    ) : null

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
          onClick={() => navigate(editable ? { name: 'inProgress', projectId } : { name: 'project', projectId })}
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
          {editing === 'title' ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveEdit()
                    if (e.key === 'Escape') cancelEditing()
                  }}
                  autoFocus
                />
              </div>
              {editButtons}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ColorDot
                    color={data.color}
                    title={data.title}
                    className="-ml-1"
                    onChange={
                      canEdit
                        ? (color) =>
                            update.mutate(
                              { id: featureId, color },
                              { onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not change the colour') },
                            )
                        : undefined
                    }
                  />
                  <h2 className="text-lg font-semibold tracking-tight text-ink">{data.title}</h2>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <StatusPill status={data.status} />
                  <PriorityPill priority={data.priority} />
                  {data.category && data.category !== 'general' && (
                    <Badge>{data.category}</Badge>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-1">
                {editLink('title', 'Edit title')}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    onClick={() => setConfirmingDelete(true)}
                    aria-label="Delete feature"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {editing === 'description' ? (
            <MarkdownEditor
              id="edit-description"
              label="Description"
              value={description}
              onChange={setDescription}
              featureId={featureId}
              attachments={attachments}
              height="50vh"
              actions={editButtons}
            />
          ) : (
            <section>
              <PartHeading title="Description">{editLink('description', 'Edit description')}</PartHeading>
              {data.description.trim() ? (
                <Markdown text={data.description} attachments={attachments} />
              ) : (
                <p className="text-sm text-faint">No description.</p>
              )}
            </section>
          )}

          {editing === 'notes' ? (
            <div className="border-t border-border pt-3">
              <MarkdownEditor
                id="edit-notes"
                label="Notes"
                value={notes}
                onChange={setNotes}
                featureId={featureId}
                attachments={attachments}
                height="50vh"
                placeholder="Working notes: open questions, decisions, links…"
                actions={editButtons}
              />
            </div>
          ) : (
            (data.notes?.trim() || canEdit) && (
              <section className="border-t border-border pt-3">
                <PartHeading title="Notes">{editLink('notes', 'Edit notes')}</PartHeading>
                {data.notes?.trim() ? (
                  <Markdown text={data.notes} attachments={attachments} />
                ) : (
                  <p className="text-sm text-faint">No notes.</p>
                )}
              </section>
            )
          )}

          <FeatureFiles
            featureId={featureId}
            attachments={attachments}
            canEdit={canEdit}
            onInsert={
              editing === 'description'
                ? (md) => setDescription((d) => d + paragraphBreak(d) + md + '\n')
                : editing === 'notes'
                  ? (md) => setNotes((n) => n + paragraphBreak(n) + md + '\n')
                  : undefined
            }
          />

          {editing === 'tags' ? (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  label="Tags"
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveEdit()
                    if (e.key === 'Escape') cancelEditing()
                  }}
                  hint="Separate with commas"
                  autoFocus
                />
              </div>
              <div className="pt-6">{editButtons}</div>
            </div>
          ) : (
            (data.tags.length > 0 || canEdit) && (
              <div className="flex items-center gap-2">
                {data.tags.length > 0 ? (
                  <TagList tags={data.tags} max={12} />
                ) : (
                  <span className="text-xs text-faint">No tags.</span>
                )}
                {editLink('tags', 'Edit tags')}
              </div>
            )
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>Sub-features</CardTitle>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingUnder(addingUnder === featureId ? null : featureId)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              )}
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-border">
                {canEdit && addingUnder === featureId && (
                  <AddSubFeature
                    projectId={projectId}
                    parentId={featureId}
                    parentTitle={data.title}
                    level={ownLevel === null ? null : ownLevel + 1}
                    depth={0}
                    onClose={() => setAddingUnder(null)}
                  />
                )}

                {subRows.map(({ feature: child, depth, level, parts }) => (
                  <div key={child.id} className="divide-y divide-border">
                    {/* A div rather than a button, so the "+" can be a button of its
                        own; the title is the button keyboard users reach. */}
                    <div
                      onClick={() =>
                        navigate({ name: 'feature', projectId, featureId: child.id, editable })
                      }
                      className="group/row relative flex w-full cursor-pointer items-center gap-2 py-2.5 pr-4 text-left transition-colors hover:bg-raised"
                      style={{ paddingLeft: 16 + depth * SUB_INDENT }}
                    >
                      {/* One guide line per level above this one, as in the feature list. */}
                      {Array.from({ length: depth }).map((_, i) => (
                        <span
                          key={i}
                          aria-hidden
                          className="absolute inset-y-0 w-px bg-border"
                          style={{ left: 16 + 9 + i * SUB_INDENT }}
                        />
                      ))}
                      <span
                        className="shrink-0 rounded border border-border px-1 font-mono text-2xs text-faint"
                        title={`Level ${level}`}
                      >
                        L{level}
                      </span>
                      <button
                        type="button"
                        className="min-w-0 truncate rounded-sm text-left text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        {child.title}
                      </button>
                      {parts.total > 0 && (
                        <span
                          className={cn(
                            'shrink-0 text-2xs tabular-nums',
                            parts.done === parts.total ? 'text-success' : 'text-faint',
                          )}
                        >
                          {parts.done}/{parts.total} done
                        </span>
                      )}
                      {canEdit && tree && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setAddingUnder(addingUnder === child.id ? null : child.id)
                          }}
                          title={`Add a feature inside ${child.title} (L${level + 1})`}
                          aria-label={`Add a feature inside ${child.title}`}
                          aria-expanded={addingUnder === child.id}
                          // Always shown on touch screens, which have no hover; with
                          // a mouse it appears when the row is hovered.
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-md border transition [@media(hover:hover)]:h-6 [@media(hover:hover)]:w-6',
                            addingUnder === child.id
                              ? 'border-accent bg-accent-soft text-accent'
                              : 'border-border text-muted hover:border-accent hover:text-accent [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100',
                          )}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <span className="flex-1" />
                      <StatusPill status={child.status} />
                    </div>

                    {canEdit && addingUnder === child.id && (
                      <AddSubFeature
                        projectId={projectId}
                        parentId={child.id}
                        parentTitle={child.title}
                        level={level + 1}
                        depth={depth + 1}
                        onClose={() => setAddingUnder(null)}
                      />
                    )}
                  </div>
                ))}

                {subRows.length === 0 && (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-muted">No sub-features yet</p>
                    <p className="mt-0.5 text-xs text-faint">
                      A sub-feature is the next level down inside this feature.
                    </p>
                    {canEdit && addingUnder !== featureId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-3"
                        onClick={() => setAddingUnder(featureId)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add the first sub-feature
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <TaskList
            featureId={featureId}
            projectId={projectId}
            onOpenTask={setOpenTaskId}
          />
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
                  disabled={!canEdit}
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
                  disabled={!canEdit}
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
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors',
        active
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-raised hover:text-ink',
        disabled && !active && 'cursor-default opacity-50 hover:bg-transparent hover:text-muted',
        disabled && 'cursor-default',
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

/**
 * Adds features one level below this one, by name. Enter adds and keeps the
 * box ready for the next name, the same as the quick add in the feature list.
 */
function AddSubFeature({
  projectId,
  parentId,
  parentTitle,
  level,
  depth,
  onClose,
}: {
  projectId: number
  parentId: number
  /** Named in the box, so it is clear where the new feature goes. */
  parentTitle: string
  /** The level the new feature will have; null while it is not known yet. */
  level: number | null
  /** How far the box is indented, in tree levels below the open feature. */
  depth: number
  onClose: () => void
}) {
  const create = useCreateFeature(projectId)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function submit() {
    const name = title.trim()
    if (!name) return
    setError('')
    try {
      await create.mutateAsync({ title: name, parent_feature_id: parentId })
      setTitle('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the sub-feature')
    } finally {
      // The input was disabled while saving, so focus goes back for the next name.
      setTimeout(() => input.current?.focus(), 0)
    }
  }

  return (
    <div
      className="relative bg-accent-soft/40 py-2.5 pr-4"
      style={{ paddingLeft: 16 + depth * SUB_INDENT }}
    >
      {/* The same guide lines as the rows, so the box sits in the tree. */}
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: 16 + 9 + i * SUB_INDENT }}
        />
      ))}
      <div className="flex items-center gap-2">
        {level !== null && (
          <span
            className="shrink-0 rounded border border-accent/50 px-1 font-mono text-2xs text-accent"
            title={`The new feature will be level ${level}`}
          >
            L{level}
          </span>
        )}
        <input
          ref={input}
          value={title}
          disabled={create.isPending}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
          autoFocus
          enterKeyHint="enter"
          placeholder={`New feature inside ${parentTitle}`}
          aria-label={`New feature inside ${parentTitle}`}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <Button size="sm" variant="secondary" onClick={submit} disabled={!title.trim()} loading={create.isPending}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : (
        <p className="mt-1.5 text-2xs text-faint">
          Goes inside <span className="font-medium text-muted">{parentTitle}</span>
          {level !== null && <> as an L{level} feature</>}. Enter adds and keeps the box open.
        </p>
      )}
    </div>
  )
}
