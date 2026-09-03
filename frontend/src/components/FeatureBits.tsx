import { Circle, CircleDashed, CircleCheck, ChevronUp, Minus, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type FeaturePriority,
  type FeatureStatus,
} from '@/lib/types'

/**
 * Status and priority are shown in many places, so their appearance is defined
 * once here. Each pairs an icon with a colour rather than relying on colour
 * alone, which would leave the distinction invisible to anyone who cannot
 * separate the hues.
 */

const STATUS_STYLE: Record<FeatureStatus, { icon: typeof Circle; className: string }> = {
  todo: { icon: CircleDashed, className: 'text-faint' },
  in_progress: { icon: Circle, className: 'text-warning' },
  done: { icon: CircleCheck, className: 'text-success' },
}

export function StatusPill({ status }: { status: FeatureStatus }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.todo
  const Icon = style.icon

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', style.className)} aria-hidden />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

const PRIORITY_STYLE: Record<FeaturePriority, { icon: typeof ChevronUp; className: string }> = {
  high: { icon: ChevronUp, className: 'text-danger' },
  medium: { icon: Minus, className: 'text-warning' },
  low: { icon: ChevronDown, className: 'text-faint' },
}

export function PriorityPill({ priority }: { priority: FeaturePriority }) {
  const style = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.medium
  const Icon = style.icon

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted"
      title={`${PRIORITY_LABEL[priority] ?? priority} priority`}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', style.className)} aria-hidden />
      {PRIORITY_LABEL[priority] ?? priority}
    </span>
  )
}

export function TagList({ tags, max = 4 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null

  const shown = tags.slice(0, max)
  const hidden = tags.length - shown.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <Badge key={tag} tone="accent">
          {tag}
        </Badge>
      ))}
      {hidden > 0 && (
        <span className="text-2xs text-faint" title={tags.slice(max).join(', ')}>
          +{hidden}
        </span>
      )}
    </div>
  )
}
