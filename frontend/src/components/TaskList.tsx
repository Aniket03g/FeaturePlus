import { useState, type FormEvent } from 'react'
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useCreateTask, useDeleteTask, useTasks, type TaskFilters } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, plural } from '@/lib/utils'
import type { Task } from '@/lib/types'

/**
 * The tasks under a feature.
 *
 * There is no "mark done" control, and that is deliberate rather than missing:
 * a task's completion is derived from its pull requests, so it becomes done
 * when one is tested and approved. A checkbox here would imply a stored flag
 * that does not exist and could not be honoured.
 */
export function TaskList({
  featureId,
  projectId,
  onOpenTask,
}: {
  featureId: number
  projectId: number
  onOpenTask: (taskId: number) => void
}) {
  const [filters, setFilters] = useState<TaskFilters>({})
  const [adding, setAdding] = useState(false)

  const tasks = useTasks(featureId, filters)
  const items = tasks.data?.items ?? []

  const outstanding = items.filter((t) => !t.done).length
  const showing = filters.done ?? ''

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>
          Tasks
          {!tasks.isLoading && items.length > 0 && (
            <span className="ml-2 font-normal text-faint">
              {outstanding > 0 ? `${outstanding} outstanding` : 'all complete'}
            </span>
          )}
        </CardTitle>

        <div className="flex items-center gap-1">
          <Segment
            value={showing}
            onChange={(value) => setFilters((f) => ({ ...f, done: value as TaskFilters['done'] }))}
            options={[
              ['', 'All'],
              ['false', 'Open'],
              ['true', 'Done'],
            ]}
          />
          <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </CardHeader>

      {adding && (
        <div className="border-b border-border bg-raised/40 px-4 py-3">
          <NewTaskForm
            featureId={featureId}
            projectId={projectId}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      <CardBody className="p-0">
        {tasks.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted">
              {filters.done ? 'No tasks in this view' : 'No tasks yet'}
            </p>
            {!filters.done && !adding && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add the first task
              </Button>
            )}
          </div>
        ) : (
          <div
            className={cn(
              'divide-y divide-border transition-opacity',
              tasks.isFetching && 'opacity-60',
            )}
          >
            {items.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                featureId={featureId}
                projectId={projectId}
                onOpen={() => onOpenTask(task.id)}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function TaskRow({
  task,
  featureId,
  projectId,
  onOpen,
}: {
  task: Task
  featureId: number
  projectId: number
  onOpen: () => void
}) {
  const remove = useDeleteTask(featureId, projectId)
  const [error, setError] = useState('')

  async function handleDelete(event: React.MouseEvent) {
    event.stopPropagation()
    setError('')
    try {
      await remove.mutateAsync(task.id)
    } catch (err) {
      // A task with pull requests cannot be deleted; show why, in place.
      setError(err instanceof ApiError ? err.message : 'Could not delete this task')
    }
  }

  return (
    <div className="group">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
      >
        {task.done ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Complete" />
        ) : (
          <Circle className="h-4 w-4 shrink-0 text-faint" aria-label="Outstanding" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'truncate text-sm',
                task.done ? 'text-muted line-through decoration-faint' : 'text-ink',
              )}
            >
              {task.task_name}
            </span>
            {task.task_type && <Badge>{task.task_type}</Badge>}
          </div>
          {task.description && (
            <p className="mt-0.5 truncate text-xs text-muted">{task.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-2xs text-faint">
          {task.comment_count > 0 && (
            <span className="flex items-center gap-1" title={plural(task.comment_count, 'comment')}>
              <MessageSquare className="h-3 w-3" />
              {task.comment_count}
            </span>
          )}
          {task.pull_requests.length > 0 && (
            <span
              className={cn(
                'flex items-center gap-1',
                task.done ? 'text-success' : 'text-muted',
              )}
              title={plural(task.pull_requests.length, 'pull request')}
            >
              <ExternalLink className="h-3 w-3" />
              {task.pull_requests.length}
            </span>
          )}
          <button
            onClick={handleDelete}
            aria-label={`Delete ${task.task_name}`}
            className="opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-t border-border bg-danger-soft px-4 py-2 text-2xs text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

function NewTaskForm({
  featureId,
  projectId,
  onDone,
}: {
  featureId: number
  projectId: number
  onDone: () => void
}) {
  const create = useCreateTask(featureId, projectId)

  const [name, setName] = useState('')
  const [type, setType] = useState('Dev')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await create.mutateAsync({ task_name: name, task_type: type })
      setName('')
      onDone()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.fields.task_name || err.message
          : 'Could not create this task',
      )
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-2">
      <div className="flex-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What needs doing?"
          aria-label="Task name"
          error={error}
          autoFocus
        />
      </div>

      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        aria-label="Task type"
        className="h-9 rounded-md border border-border bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        {['Dev', 'UI', 'DB', 'Backend', 'API', 'Test', 'Docs'].map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
        Add
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  )
}

function Segment({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: [string, string][]
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Filter tasks">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            'rounded px-2 py-0.5 text-2xs transition-colors',
            value === key
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-muted hover:bg-raised hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
