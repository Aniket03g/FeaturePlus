import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Link2,
  Minus,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { parseVersionRef, useCompareLists, useCopies, useVersions } from '@/lib/queries'
import { buildDiffTree, type DiffNode } from '@/lib/compare-tree'
import { Branch, type Filter } from '@/components/DiffTree'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'


const FILTERS: { id: Filter; label: string; icon: ReactNode; tone: string }[] = [
  { id: 'all', label: 'All differences', icon: null, tone: 'text-ink' },
  { id: 'added', label: 'Added', icon: <Plus className="h-3 w-3" />, tone: 'text-success' },
  { id: 'removed', label: 'Removed', icon: <Minus className="h-3 w-3" />, tone: 'text-danger' },
  { id: 'renamed', label: 'Renamed', icon: <span className="h-1.5 w-1.5 rounded-full bg-warning" />, tone: 'text-warning' },
  { id: 'moved', label: 'Moved', icon: <ArrowRight className="h-3 w-3" />, tone: 'text-warning' },
  { id: 'needs', label: 'Dependencies', icon: <Link2 className="h-3 w-3" />, tone: 'text-warning' },
  { id: 'details', label: 'Details', icon: <MoreHorizontal className="h-3 w-3" />, tone: 'text-muted' },
]

/**
 * Two feature lists compared as one tree: the newer list's tree, with each
 * difference shown where it happened. Either side can be a saved version, a
 * copy you can see, or the list as it is now.
 *
 * Unchanged features fold into "N unchanged features" so the changes stand
 * out, and "Only changes" hides them altogether. The side panel counts each
 * kind of difference and steps through them one at a time.
 */
export function ComparePage({ projectId, from: fromText, to: toText }: { projectId: number; from: string; to: string }) {
  const { navigate } = useRouter()
  const from = parseVersionRef(fromText)
  const to = parseVersionRef(toText)
  const versions = useVersions(projectId)
  const copies = useCopies(projectId)
  const compare = useCompareLists(projectId, from, to)

  const [onlyChanges, setOnlyChanges] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [cursor, setCursor] = useState(-1)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())

  const tree = useMemo(
    () => (compare.data?.from_list && compare.data.to_list ? buildDiffTree(compare.data.from_list, compare.data.to_list) : null),
    [compare.data],
  )
  const parents = useMemo(() => {
    const out = new Map<string, string>()
    const walk = (nodes: DiffNode[], parent: string) =>
      nodes.forEach((n) => {
        out.set(n.key, parent)
        walk(n.children, n.key)
      })
    if (tree) walk(tree.roots, '')
    return out
  }, [tree])

  const matching = useMemo(
    () => (tree ? tree.order.filter((n) => filter === 'all' || n.kinds.includes(filter)) : []),
    [tree, filter],
  )
  useEffect(() => setCursor(-1), [filter, tree])

  // Stepping to a change opens whatever it sits inside, then brings it into view.
  function jump(index: number) {
    const node = matching[index]
    if (!node) return
    setCursor(index)
    setCollapsed((now) => {
      const next = new Set(now)
      for (let p = parents.get(node.key); p; p = parents.get(p)) next.delete(p)
      return next
    })
    requestAnimationFrame(() =>
      document.getElementById(`diff-${node.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    )
  }

  const go = (nextFrom: string, nextTo: string) => navigate({ name: 'compare', projectId, from: nextFrom, to: nextTo })

  const options = (
    <>
      <option value="current">The list as it is now</option>
      {(versions.data ?? []).length > 0 && (
        <optgroup label="Versions">
          {versions.data!.map((v) => (
            <option key={v.id} value={String(v.id)}>
              v{v.number} · {v.tag}
            </option>
          ))}
        </optgroup>
      )}
      {(copies.data ?? []).length > 0 && (
        <optgroup label="Copies">
          {copies.data!.map((c) => (
            <option key={c.id} value={`c${c.id}`}>
              {c.name ? `${c.name} · copy ${c.number}` : `Copy ${c.number}`}, from v{c.base.number}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )

  const current = cursor >= 0 ? matching[cursor] : undefined

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
        onClick={() => navigate({ name: 'versions', projectId })}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Versions
      </button>

      <div className="rounded-lg border border-border bg-surface">
        {/* What is compared with what */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-xs text-muted">Compare</span>
          <select
            aria-label="Compare from"
            className="h-8 min-w-[12rem] max-w-full flex-1 rounded-md border border-border bg-raised px-2 text-sm text-ink focus:border-accent focus:outline-none lg:max-w-xs"
            value={fromText}
            onChange={(e) => go(e.target.value, toText)}
          >
            {options}
          </select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => go(toText, fromText)}
            aria-label="Swap the two sides"
            title="Swap the two sides"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <select
            aria-label="Compare to"
            className="h-8 min-w-[12rem] max-w-full flex-1 rounded-md border border-border bg-raised px-2 text-sm text-ink focus:border-accent focus:outline-none lg:max-w-xs"
            value={toText}
            onChange={(e) => go(fromText, e.target.value)}
          >
            {options}
          </select>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
            Only changes
          </label>
        </div>

        {from === null || to === null ? (
          <p className="p-6 text-sm text-danger">This link doesn’t name two lists to compare.</p>
        ) : compare.isLoading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-5 w-64" />
          </div>
        ) : compare.isError || !tree ? (
          <p className="p-6 text-sm text-danger">
            {compare.error instanceof ApiError ? compare.error.message : 'Could not compare these two lists.'}
          </p>
        ) : (
          <div className={cn('grid lg:grid-cols-[minmax(0,1fr)_17rem]', compare.isFetching && 'opacity-70')}>
            {/* The panel: on top on a phone, on the right on a computer */}
            <aside className="border-b border-border p-4 lg:order-2 lg:border-b-0 lg:border-l">
              <div className="lg:sticky lg:top-4 lg:space-y-5">
                <div>
                  <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted">Differences</h3>
                  <p className="mb-2 hidden text-xs text-faint lg:block">Click one to jump through them</p>
                  <div className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible">
                    {FILTERS.filter((f) => f.id === 'all' || tree.counts[f.id] > 0).map((f) => {
                      const count = f.id === 'all' ? tree.counts.all : tree.counts[f.id]
                      return (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={filter === f.id}
                          onClick={() => {
                            setFilter(f.id)
                          }}
                          className={cn(
                            'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors lg:w-full',
                            filter === f.id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
                          )}
                        >
                          {f.icon && (
                            <span className={cn('flex h-4 w-4 items-center justify-center rounded bg-raised', f.tone)}>{f.icon}</span>
                          )}
                          <span className="flex-1 whitespace-nowrap">{f.label}</span>
                          <span className={cn('tabular-nums', f.id === 'all' ? 'text-ink' : f.tone)}>{count}</span>
                        </button>
                      )
                    })}
                  </div>
                  {matching.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 w-8 p-0"
                        disabled={cursor <= 0}
                        onClick={() => jump(cursor - 1)}
                        aria-label="Previous difference"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 w-8 p-0"
                        disabled={cursor >= matching.length - 1}
                        onClick={() => jump(cursor + 1)}
                        aria-label="Next difference"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-muted">
                        {cursor >= 0 ? `${cursor + 1} of ${matching.length}` : `${matching.length} to step through`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 lg:mt-0 lg:block lg:pt-4">
                  <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted">Feature count</h3>
                  <p className="text-base font-semibold text-ink lg:mt-1 lg:text-xl">
                    {tree.featureCount.from} <span className="text-faint">→</span> {tree.featureCount.to}
                  </p>
                  <CountBar count={tree.featureCount} />
                  <p className="text-xs text-muted lg:mt-1.5">
                    {tree.featureCount.untouched} untouched · {tree.featureCount.changed} changed · {tree.featureCount.added} added ·{' '}
                    {tree.featureCount.removed} removed
                  </p>
                </div>
              </div>
            </aside>

            {/* The tree */}
            <div className="min-w-0 p-4 lg:order-1">
              {tree.counts.all === 0 && (
                <p className="mb-3 rounded-md border border-border bg-raised/40 px-3 py-2 text-sm text-muted">
                  No differences. These two lists are the same.
                </p>
              )}
              <div className="flex items-center gap-1.5 py-1 text-sm font-semibold text-ink">
                <ChevronDown className="h-4 w-4 text-faint" aria-hidden />
                {compare.data?.to_list?.project.name || 'Features'}
              </div>
              <Branch
                nodes={tree.roots}
                onlyChanges={onlyChanges}
                filter={filter}
                current={current?.key}
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CountBar({ count }: { count: { untouched: number; changed: number; added: number; removed: number } }) {
  const total = count.untouched + count.changed + count.added + count.removed || 1
  const part = (n: number, className: string) =>
    n > 0 ? <span className={className} style={{ width: `${(n / total) * 100}%` }} /> : null
  return (
    <div className="order-last mt-1 flex h-1.5 basis-full overflow-hidden rounded-full bg-border lg:mt-2" aria-hidden>
      {part(count.untouched, 'bg-faint/40')}
      {part(count.changed, 'bg-warning')}
      {part(count.added, 'bg-success')}
      {part(count.removed, 'bg-danger')}
    </div>
  )
}
