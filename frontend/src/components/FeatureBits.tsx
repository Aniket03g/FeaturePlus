import { Circle, CircleDashed, CircleCheck, ChevronUp, Minus, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABEL,
  statusLabel,
  type FeaturePriority,
  type FeatureStatus,
  type StatusParamDef,
  type StatusParams,
} from '@/lib/types'

/**
 * Status and priority are shown in many places, so their appearance is defined
 * once here. Each pairs an icon with a colour rather than relying on colour
 * alone, which would leave the distinction invisible to anyone who cannot
 * separate the hues.
 */

// Icons for the built-in default statuses. A project's own statuses have no
// fixed icon, so they fall back to a neutral circle keyed off the position of
// "done"-like and "progress"-like names where recognisable.
const STATUS_STYLE: Record<string, { icon: typeof Circle; className: string }> = {
  todo: { icon: CircleDashed, className: 'text-faint' },
  in_progress: { icon: Circle, className: 'text-warning' },
  done: { icon: CircleCheck, className: 'text-success' },
}

export function StatusPill({ status, label }: { status: FeatureStatus; label?: string }) {
  const style = STATUS_STYLE[status] ?? { icon: Circle, className: 'text-muted' }
  const Icon = style.icon

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', style.className)} aria-hidden />
      {label ?? statusLabel(status)}
    </span>
  )
}

/** Title-case a parameter key as a fallback when no definition names it. */
function titleCaseKey(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * The parameter values worth showing for a status: the ones actually set, in
 * the order the status defines them, each paired with its UI name.
 */
function paramEntries(params?: StatusParams, defs?: StatusParamDef[]) {
  if (!params) return []
  const labelByKey = new Map((defs ?? []).map((d) => [d.key, d.ui_name]))
  const ordered = (defs ?? []).map((d) => d.key).filter((k) => k in params)
  const extra = Object.keys(params).filter((k) => !labelByKey.has(k))
  return [...ordered, ...extra]
    .filter((k) => params[k] !== '' && params[k] !== null && params[k] !== undefined)
    .map((k) => ({ key: k, label: labelByKey.get(k) ?? titleCaseKey(k), value: params[k] }))
}

/**
 * A status in the feature list: the pill, plus a compact box of its parameter
 * values shown on hover or when the pill is focused (click/keyboard). When the
 * status has no values set it is just the pill, with no extra affordance.
 */
export function StatusCell({
  status,
  params,
  defs,
  label,
}: {
  status: FeatureStatus
  params?: StatusParams
  defs?: StatusParamDef[]
  label?: string
}) {
  const entries = paramEntries(params, defs)
  if (entries.length === 0) {
    return <StatusPill status={status} label={label} />
  }
  return (
    <span className="group/status relative inline-block">
      <button
        type="button"
        aria-label={`${label ?? statusLabel(status)} details`}
        className="inline-flex items-center gap-1 rounded underline decoration-dotted decoration-faint underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <StatusPill status={status} label={label} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden min-w-[9rem] max-w-[15rem] rounded-md border border-border bg-surface p-2 text-xs shadow-md group-hover/status:block group-focus-within/status:block"
      >
        {entries.map((e) => (
          <span key={e.key} className="flex items-baseline justify-between gap-3 py-0.5">
            <span className="shrink-0 text-muted">{e.label}</span>
            <span className="truncate text-right font-medium text-ink">{String(e.value)}</span>
          </span>
        ))}
      </span>
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
