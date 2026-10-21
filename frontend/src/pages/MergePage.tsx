import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Info, X } from 'lucide-react'
import { useMergeCopy, useMergePreview, type MergeChoices, type MergePreview } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, plural } from '@/lib/utils'

type Clash = MergePreview['clashes'][number]
type Change = MergePreview['changes'][number]
type Pick = 'list' | 'copy'

/**
 * Merging a published copy into the project's list, on a page of its own so
 * it has room, a link, and the browser's back button.
 *
 * It reads top to bottom: where the copy started, what it is, what it lands
 * on; four counts; then the clashes to decide, the changes that will happen,
 * what is left out and why, and anything that blocks the merge. The merge
 * button sits at the foot of the screen and only works once every clash has a
 * pick. On a computer every clash shows at once; on a phone, one at a time.
 *
 * Nothing is written until the button. The server works the plan out again
 * when it is pressed, so a list that changed in the meantime is caught there.
 */
export function MergePage({ projectId, copyId }: { projectId: number; copyId: number }) {
  const { navigate } = useRouter()
  const [choices, setChoices] = useState<MergeChoices>({})
  const preview = useMergePreview(projectId, copyId, choices)
  const merge = useMergeCopy(projectId)
  const [error, setError] = useState('')

  const backToCopies = () => navigate({ name: 'versions', projectId, tab: 'copies' })

  async function handleMerge() {
    setError('')
    try {
      await merge.mutateAsync({ copyId, choices })
      backToCopies()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
      preview.refetch()
    }
  }

  if (preview.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (preview.isError || !preview.data) {
    const refused = preview.error instanceof ApiError ? preview.error : null
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {refused?.status === 403
            ? 'Only the project’s owners and editors can merge copies.'
            : (refused?.message ?? 'Could not work out the merge.')}
        </p>
        <Button variant="secondary" size="sm" onClick={backToCopies}>
          Back to copies
        </Button>
      </div>
    )
  }

  const data = preview.data
  const { copy, changes, clashes, notes, problems } = data
  const name = copy.name || `Copy ${copy.number}`
  const base = `v${copy.base.number}`
  const left = clashes.filter((clash) => !choices[clash.key]).length
  const ready = data.ready && left === 0 && !preview.isFetching
  const pickAll = (pick: Pick) => setChoices(Object.fromEntries(clashes.map((clash) => [clash.key, pick])))
  const pick = (key: string, value: Pick) => setChoices((now) => ({ ...now, [key]: value }))

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-lg border border-border bg-surface">
        {/* Heading */}
        <div className="flex items-start gap-3 px-4 pb-4 pt-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <nav className="flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
              <button type="button" className="hover:text-ink hover:underline" onClick={() => navigate({ name: 'versions', projectId })}>
                Versions
              </button>
              <ChevronRight className="h-3 w-3 text-faint" aria-hidden />
              <button type="button" className="hover:text-ink hover:underline" onClick={backToCopies}>
                Copies
              </button>
              <ChevronRight className="h-3 w-3 text-faint" aria-hidden />
              <span className="truncate text-ink">{name}</span>
            </nav>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              Merge {copy.name ? `“${copy.name}”` : `copy ${copy.number}`} into the list
            </h2>
            <button
              type="button"
              className="mt-1 text-xs text-accent hover:underline"
              onClick={() => navigate({ name: 'compare', projectId, from: String(copy.base.id), to: `c${copy.id}` })}
            >
              See everything this copy changes, as a tree
            </button>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={backToCopies} aria-label="Close and go back to copies">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Where it started → the copy → the list now */}
        <div className="grid items-center gap-2 px-4 sm:px-5 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <Place label="Where the copy started">
            <span className="text-accent">{base}</span> {copy.base.tag}
          </Place>
          <Joiner text={`what ${copy.mine ? 'you' : copy.owner.name || 'its owner'} changed`} />
          <Place label={copy.number ? `The copy · #${copy.number}` : 'The copy'} accent>
            {name}
          </Place>
          <Joiner text="applied on top of" />
          <Place label={`The list now · changed since ${base}`}>
            {typeof data.list_features === 'number' ? plural(data.list_features, 'feature') : 'As it is now'}
          </Place>
        </div>

        {/* Counts */}
        <div className="grid grid-cols-2 gap-2 px-4 pt-3 sm:px-5 lg:grid-cols-4">
          <Tile
            href="#clashes"
            count={clashes.length}
            label={clashes.length === 0 ? 'Clashes' : left > 0 ? `Clashes · ${left} to decide` : 'Clashes · all decided'}
            tone={clashes.length > 0 && left > 0 ? 'warning' : 'plain'}
          />
          <Tile href="#changes" count={changes.length} label="Changes that will happen" tone={changes.length > 0 ? 'success' : 'plain'} />
          <Tile href="#left-out" count={notes.length} label="Left out, with reasons" tone="plain" />
          <Tile href="#problems" count={problems.length} label="Problems" tone={problems.length > 0 ? 'danger' : 'success'} />
        </div>

        <div className={cn('space-y-7 px-4 pb-6 pt-6 sm:px-5', preview.isFetching && 'opacity-80')}>
          {/* 1 · Clashes */}
          {clashes.length > 0 && (
            <section id="clashes" className="scroll-mt-4 space-y-3">
              <SectionHeading
                n={1}
                title="Decide the clashes"
                aside={
                  <span className="flex items-center gap-2">
                    <Progress done={clashes.length - left} total={clashes.length} />
                    {clashes.length - left} of {clashes.length} decided
                  </span>
                }
              />
              <p className="text-sm text-muted">
                The same feature was changed in the copy and in the list since {base}. Pick which one wins.
              </p>
              {clashes.length >= 3 && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => pickAll('list')}>
                    Keep the list’s for all
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => pickAll('copy')}>
                    Take the copy’s for all
                  </Button>
                </div>
              )}

              {/* A computer shows every clash; a phone steps through them. */}
              <div className="hidden space-y-3 sm:block">
                {clashes.map((clash) => (
                  <ClashCard key={clash.key} clash={clash} base={base} owner={copyOwner(copy)} choice={choices[clash.key]} onPick={(v) => pick(clash.key, v)} group="wide" />
                ))}
              </div>
              <div className="sm:hidden">
                <ClashStepper clashes={clashes} base={base} owner={copyOwner(copy)} choices={choices} onPick={pick} />
              </div>
            </section>
          )}

          {/* 2 · Changes */}
          <section id="changes" className="scroll-mt-4 space-y-3">
            <SectionHeading n={clashes.length > 0 ? 2 : 1} title="What will change" aside={plural(changes.length, 'change')} />
            {changes.length === 0 ? (
              <p className="text-sm text-muted">Nothing in the list would change.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {changes.map((change, index) => (
                  <ChangeRow key={`${change.kind}-${change.key}-${index}`} change={change} />
                ))}
              </ul>
            )}
          </section>

          {/* 3 · Left out */}
          {notes.length > 0 && (
            <section id="left-out" className="scroll-mt-4 space-y-3">
              <SectionHeading n={clashes.length > 0 ? 3 : 2} title="Left out" aside="won’t happen" />
              <ul className="space-y-2">
                {notes.map((note, index) => (
                  <li
                    key={`${note.title}-${index}`}
                    className="flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted"
                  >
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
                    <span>
                      <span className="font-medium text-ink">{note.title}</span>: {note.message}.
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Problems */}
          <section id="problems" className="scroll-mt-4">
            {problems.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                No problems found. Nothing blocks this merge.
              </p>
            ) : (
              <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  This copy can’t be merged as it is
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-10">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* Footer: stays in view while scrolling */}
        <div className="sticky bottom-0 flex flex-col gap-3 rounded-b-lg border-t border-border bg-surface px-4 py-4 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.5)] sm:flex-row sm:items-center sm:px-5">
          <p className="flex-1 text-xs text-muted">
            The list is saved as a version just before and just after, so you can always go back. Only names, nesting and
            dependencies change. Tasks, status and descriptions stay as they are.
          </p>
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            {error && (
              <p role="alert" className="max-w-xs text-xs text-danger">
                {error}
              </p>
            )}
            <Button disabled={!ready || changes.length === 0} loading={merge.isPending} onClick={handleMerge}>
              Merge into the list
            </Button>
            <p className="text-center text-xs text-warning sm:text-right">
              {left > 0
                ? `Decide ${left} more ${left === 1 ? 'clash' : 'clashes'}`
                : problems.length > 0
                  ? 'Blocked by a problem'
                  : changes.length === 0
                    ? 'Nothing to merge'
                    : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function copyOwner(copy: MergePreview['copy']) {
  return copy.mine ? 'you' : copy.owner.name || 'its owner'
}

// ---------- the top ----------

function Place({ label, accent, children }: { label: string; accent?: boolean; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 rounded-md border px-3 py-2', accent ? 'border-accent/50' : 'border-border')}>
      <p className="text-2xs text-faint">{label}</p>
      <p className="truncate text-sm font-semibold text-ink">{children}</p>
    </div>
  )
}

function Joiner({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 text-2xs text-faint lg:flex-col lg:gap-0.5 lg:px-1">
      <ArrowRight className="hidden h-4 w-4 lg:block" aria-hidden />
      <ArrowDown className="h-3.5 w-3.5 lg:hidden" aria-hidden />
      <span className="text-center lg:max-w-[6rem]">{text}</span>
    </div>
  )
}

function Tile({
  href,
  count,
  label,
  tone,
}: {
  href: string
  count: number
  label: string
  tone: 'plain' | 'warning' | 'success' | 'danger'
}) {
  return (
    <a
      href={href}
      className={cn(
        'rounded-md border px-3 py-2.5 transition-colors hover:border-accent/50',
        tone === 'warning' ? 'border-warning/50 bg-warning-soft' : 'border-border bg-raised/40',
      )}
    >
      <p
        className={cn(
          'text-xl font-semibold',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          tone === 'plain' && 'text-ink',
        )}
      >
        {count}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </a>
  )
}

function SectionHeading({ n, title, aside }: { n: number; title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="shrink-0 text-2xs font-semibold uppercase tracking-wider text-muted">
        {n} · {title}
      </h3>
      <div className="h-px flex-1 bg-border" />
      {aside && <span className="shrink-0 text-xs text-muted">{aside}</span>}
    </div>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: Math.min(total, 12) }, (_, i) => (
        <span key={i} className={cn('h-1.5 w-4 rounded-full', i < done ? 'bg-accent' : 'bg-border')} />
      ))}
    </span>
  )
}

// ---------- clashes ----------

const FIELD_LABEL: Record<Clash['fields'][number]['field'], string> = {
  title: 'Name',
  parent: 'Place',
  needs: 'Depends on',
}

/** How a field's value reads; empty means a different thing per field. */
function value(field: Clash['fields'][number]['field'], text: string) {
  if (text) return field === 'needs' ? `Needs ${text}` : text
  if (field === 'parent') return 'Top level'
  if (field === 'needs') return 'Needs nothing'
  return '—'
}

function clashSummary(clash: Clash) {
  if (clash.kind === 'removed') return 'removed in the copy, changed in the list'
  const fields = clash.fields.map((f) => f.field)
  if (fields.includes('title') && fields.includes('parent')) return 'renamed and moved in both'
  return fields.includes('parent') ? 'moved in both' : 'renamed in both'
}

function ClashCard({
  clash,
  base,
  owner,
  choice,
  onPick,
  group,
}: {
  clash: Clash
  base: string
  owner: string
  choice?: Pick
  onPick: (pick: Pick) => void
  group: string
}) {
  const first = clash.fields[0]
  const removed = clash.kind === 'removed'
  const many = clash.fields.length > 1

  return (
    <div className={cn('rounded-lg border p-3 sm:p-4', choice ? 'border-border' : 'border-warning/40')}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn('h-2 w-2 shrink-0 self-center rounded-full', choice ? 'bg-success' : 'bg-warning')} aria-hidden />
        <span className="font-medium text-ink">{clash.title}</span>
        <span className="text-xs text-muted">{clashSummary(clash)}</span>
        {clash.path && <span className="ml-auto truncate font-mono text-2xs text-faint">{clash.path}</span>}
      </div>

      <div className="mt-3 space-y-2">
        {clash.fields.map((field) => (
          <div key={field.field} className="grid gap-2 lg:grid-cols-3">
            <Side label={`In ${base} (where both started)`} prefix={many ? FIELD_LABEL[field.field] : undefined}>
              {value(field.field, field.base)}
            </Side>
            <Side label="The list now" prefix={many ? FIELD_LABEL[field.field] : undefined}>
              {value(field.field, field.list)}
            </Side>
            <Side label={`The copy · ${owner}`} prefix={many ? FIELD_LABEL[field.field] : undefined}>
              {removed ? <span className="text-danger">Removed</span> : value(field.field, field.copy)}
            </Side>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={`Which wins for ${clash.title}`}>
        <Choice
          name={`${group}-${clash.key}`}
          checked={choice === 'list'}
          onChange={() => onPick('list')}
          title={removed ? 'Keep it' : 'Keep the list’s'}
          detail={removed ? 'Stays, with the list’s changes' : value(first.field, first.list)}
        />
        <Choice
          name={`${group}-${clash.key}`}
          checked={choice === 'copy'}
          onChange={() => onPick('copy')}
          title={removed ? 'Remove it' : 'Take the copy’s'}
          detail={removed ? 'Goes, as the copy asks' : value(first.field, first.copy)}
        />
      </div>
    </div>
  )
}

function Side({ label, prefix, children }: { label: string; prefix?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-raised/40 px-3 py-2">
      <p className="truncate text-2xs text-faint">
        {label}
        {prefix && ` · ${prefix}`}
      </p>
      <p className="break-words text-sm text-ink">{children}</p>
    </div>
  )
}

function Choice({
  name,
  checked,
  onChange,
  title,
  detail,
}: {
  name: string
  checked: boolean
  onChange: () => void
  title: string
  detail: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
        checked ? 'border-accent bg-accent-soft/60' : 'border-border hover:border-accent/50',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-accent bg-accent text-white' : 'border-faint',
        )}
        aria-hidden
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
    </label>
  )
}

/** On a phone: one clash at a time, with a way back and forth. */
function ClashStepper({
  clashes,
  base,
  owner,
  choices,
  onPick,
}: {
  clashes: Clash[]
  base: string
  owner: string
  choices: MergeChoices
  onPick: (key: string, pick: Pick) => void
}) {
  const [index, setIndex] = useState(0)
  const at = Math.min(index, clashes.length - 1)
  const clash = clashes[at]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex flex-1 gap-1" aria-hidden>
          {clashes.map((c, i) => (
            <span
              key={c.key}
              className={cn('h-1.5 flex-1 rounded-full', i === at ? 'bg-accent' : choices[c.key] ? 'bg-accent/40' : 'bg-border')}
            />
          ))}
        </span>
        <span className="shrink-0 text-xs text-warning">
          Clash {at + 1} of {clashes.length}
        </span>
      </div>
      <ClashCard
        clash={clash}
        base={base}
        owner={owner}
        choice={choices[clash.key]}
        onPick={(pick) => onPick(clash.key, pick)}
        group="narrow"
      />
      <div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => setIndex(at - 1)}>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={at === clashes.length - 1} onClick={() => setIndex(at + 1)}>
          Next clash
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ---------- changes ----------

const KIND: Record<Change['kind'], { label: string; className: string }> = {
  added: { label: 'Add', className: 'bg-success-soft text-success' },
  renamed: { label: 'Rename', className: 'bg-warning-soft text-warning' },
  moved: { label: 'Move', className: 'bg-warning-soft text-warning' },
  removed: { label: 'Remove', className: 'bg-danger-soft text-danger' },
  needs_added: { label: 'Needs', className: 'bg-warning-soft text-warning' },
  needs_removed: { label: 'Needs', className: 'bg-warning-soft text-warning' },
}

const top = (path?: string) => path || 'Top level'

function ChangeRow({ change }: { change: Change }) {
  const kind = KIND[change.kind]
  let where: string = top(change.path)
  if (change.kind === 'added') where = change.path ? `inside ${change.path}` : 'Top level'
  if (change.kind === 'moved') where = `${top(change.from)} → ${top(change.to)}`
  if (change.kind === 'removed') where = `${top(change.path)} · no tasks`

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className={cn('w-16 shrink-0 rounded py-0.5 text-center text-2xs font-medium', kind.className)}>{kind.label}</span>
      <span className="min-w-0 flex-1 text-sm">
        {change.kind === 'renamed' ? (
          <>
            <span className="text-muted line-through">{change.from}</span>
            <span className="mx-1.5 text-faint">→</span>
            <span className="font-medium text-ink">{change.to}</span>
          </>
        ) : (
          <span className="font-medium text-ink">{change.title}</span>
        )}
        {change.kind === 'needs_added' && (
          <>
            <span className="mx-1.5 text-muted">now needs</span>
            <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-ink">{change.to}</span>
          </>
        )}
        {change.kind === 'needs_removed' && (
          <>
            <span className="mx-1.5 text-muted">no longer needs</span>
            <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted line-through">{change.from}</span>
          </>
        )}
      </span>
      <span className="w-full truncate pl-[4.75rem] font-mono text-2xs text-faint sm:w-auto sm:max-w-[45%] sm:pl-0 sm:text-right" title={where}>
        {where}
      </span>
    </li>
  )
}
