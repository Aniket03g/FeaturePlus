import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, Minus, MoreHorizontal, Plus } from 'lucide-react'
import type { DiffKind, DiffNode, DiffTree } from '@/lib/compare-tree'
import { cn } from '@/lib/utils'

/**
 * A compared tree, drawn: the newer list's tree with each difference shown
 * where it happened. Used by the Compare page, which steers it (jumping
 * opens branches), and by the upload check, which shows it on its own.
 */

/** Which kind of difference the page is stepping through; others are dimmed. */
export type Filter = 'all' | DiffKind

export interface BranchProps {
  nodes: DiffNode[]
  onlyChanges: boolean
  filter: Filter
  current?: string
  collapsed: Set<string>
  onToggle: (key: string, open: boolean) => void
  unfolded: Set<string>
  onUnfold: (key: string) => void
}

/**
 * One level of the tree. Two or more unchanged features in a row fold into a
 * single "N unchanged features" line until it is clicked.
 */
export function Branch(props: BranchProps) {
  const { nodes, onlyChanges, unfolded, onUnfold } = props
  const items: ReactNode[] = []
  let run: DiffNode[] = []

  const flush = () => {
    if (run.length >= 2 && !unfolded.has(run[0].key)) {
      const first = run[0].key
      const count = run.length
      items.push(
        <li key={`fold-${first}`}>
          <button
            type="button"
            className="flex items-center gap-2 rounded px-2 py-1 text-xs text-faint hover:text-ink"
            onClick={() => onUnfold(first)}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            {count} unchanged features
          </button>
        </li>,
      )
    } else {
      for (const node of run) items.push(<Node key={node.key} {...props} node={node} />)
    }
    run = []
  }

  for (const node of nodes) {
    if (!node.hasChange) {
      if (!onlyChanges) run.push(node)
      continue
    }
    flush()
    items.push(<Node key={node.key} {...props} node={node} />)
  }
  flush()

  if (items.length === 0) return null
  return <ul className="ml-2 space-y-0.5 border-l border-border pl-3">{items}</ul>
}

const ROW_TONE: Record<DiffNode['state'], string> = {
  same: '',
  changed: '',
  added: 'bg-success-soft/50',
  removed: 'bg-danger-soft/50',
  ghost: 'border border-dashed border-border',
}

function Node({ node, ...props }: BranchProps & { node: DiffNode }) {
  const { filter, current, collapsed, onToggle } = props
  const hasChildren = node.children.length > 0
  // Branches with a change inside start open; the rest start shut.
  const open = hasChildren && (node.hasChange ? !collapsed.has(node.key) : collapsed.has(`open:${node.key}`))
  const toggle = () => {
    if (node.hasChange) onToggle(node.key, collapsed.has(node.key))
    else onToggle(`open:${node.key}`, !collapsed.has(`open:${node.key}`) ? false : true)
  }
  const strong = node.kinds.includes('renamed') || node.kinds.includes('moved')
  const dimmed = filter !== 'all' && node.state !== 'same' && node.state !== 'ghost' && !node.kinds.includes(filter)

  return (
    <li>
      <div
        id={`diff-${node.key}`}
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-sm',
          ROW_TONE[node.state],
          node.state === 'changed' && strong && 'bg-warning-soft/40',
          current === node.key && 'ring-1 ring-warning',
          dimmed && 'opacity-40',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            className="-ml-1 text-faint hover:text-ink"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? `Fold ${node.title}` : `Open ${node.title}`}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-2.5" />
        )}
        <Marker node={node} />
        <Title node={node} />
        <Tags node={node} />
        <Label node={node} />
      </div>
      {node.details.length > 0 && (
        <p className="ml-9 pb-1 text-xs text-muted">
          {node.details.map((d, i) => (
            <span key={d.label}>
              {i > 0 && ' · '}
              {d.label === 'Description' ? (
                <span title={d.to || 'Description removed'}>Description edited</span>
              ) : (
                <>
                  {d.label}: <span className="text-faint line-through">{d.from || 'none'}</span> → {d.to || 'none'}
                </>
              )}
            </span>
          ))}
        </p>
      )}
      {open && <Branch {...props} nodes={node.children} />}
    </li>
  )
}

function Marker({ node }: { node: DiffNode }) {
  const box = 'flex h-4 w-4 shrink-0 items-center justify-center rounded'
  if (node.state === 'added') return <span className={cn(box, 'bg-success-soft text-success')}><Plus className="h-3 w-3" /></span>
  if (node.state === 'removed') return <span className={cn(box, 'bg-danger-soft text-danger')}><Minus className="h-3 w-3" /></span>
  if (node.state === 'ghost') return <ArrowDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
  if (node.kinds.includes('moved')) return <ArrowRight className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
  if (node.state === 'changed') return <span className="mx-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
  return <span className="w-4 shrink-0" />
}

function Title({ node }: { node: DiffNode }) {
  if (node.state === 'ghost') {
    return (
      <span className="text-faint">
        <span className="italic">{node.title}</span> was here · moved to {node.movedTo || 'the top level'}
      </span>
    )
  }
  if (node.state === 'removed') return <span className="text-muted line-through">{node.title}</span>
  if (node.oldTitle !== undefined) {
    return (
      <span>
        <span className="text-faint line-through">{node.oldTitle}</span>
        <span className="mx-1.5 text-faint">→</span>
        <span className="text-ink">{node.title}</span>
      </span>
    )
  }
  return (
    <span className={cn(node.state === 'same' && !node.hasChange ? 'text-muted' : 'text-ink', node.children.length > 0 && 'font-medium')}>
      {node.title}
      {node.state === 'same' && node.hasChange && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle" />}
    </span>
  )
}

function Tags({ node }: { node: DiffNode }) {
  const tag = 'rounded-full border px-2 py-0.5 text-2xs'
  return (
    <>
      {node.needs.map((n) => (
        <span key={`n-${n}`} className={cn(tag, 'border-border text-muted')}>
          needs {n}
        </span>
      ))}
      {node.needsAdded.map((n) => (
        <span key={`a-${n}`} className={cn(tag, 'border-success/50 text-success')}>
          + needs {n}
        </span>
      ))}
      {node.needsRemoved.map((n) => (
        <span key={`r-${n}`} className={cn(tag, 'border-danger/50 text-danger line-through')}>
          needs {n}
        </span>
      ))}
    </>
  )
}

function Label({ node }: { node: DiffNode }) {
  const pill = 'ml-auto shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium'
  if (node.state === 'added') return <span className={cn(pill, 'bg-success-soft text-success')}>Added</span>
  if (node.state === 'removed') return <span className={cn(pill, 'bg-danger-soft text-danger')}>Removed</span>
  if (node.kinds.includes('moved')) {
    return (
      <span className={cn(pill, 'bg-warning-soft text-warning')}>
        Moved here from {node.movedFrom || 'the top level'}
      </span>
    )
  }
  if (node.kinds.includes('renamed')) return <span className={cn(pill, 'bg-warning-soft text-warning')}>Renamed</span>
  return null
}

/**
 * The tree on its own, keeping its own open and folded state: for showing a
 * comparison somewhere that does not step through it.
 */
export function DiffTreeView({ tree, onlyChanges = false }: { tree: DiffTree; onlyChanges?: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())
  return (
    <Branch
      nodes={tree.roots}
      onlyChanges={onlyChanges}
      filter="all"
      collapsed={collapsed}
      onToggle={(key, open) =>
        setCollapsed((now) => {
          const next = new Set(now)
          if (open) next.delete(key)
          else next.add(key)
          return next
        })
      }
      unfolded={unfolded}
      onUnfold={(key) => setUnfolded((now) => new Set(now).add(key))}
    />
  )
}
