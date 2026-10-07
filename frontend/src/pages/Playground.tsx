import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  CloudOff,
  Copy,
  Loader2,
  Download,
  FileUp,
  FolderOpen,
  GripVertical,
  History,
  IndentDecrease,
  IndentIncrease,
  LayoutGrid,
  Link2,
  Milestone,
  Plus,
  SendHorizontal,
  Shapes,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import {
  AI_DRAFT_MARKER,
  addFeature,
  addNeed,
  addRelease,
  applyAiRows,
  canNeed,
  changedFromProject,
  childrenOf,
  replannedFromProject,
  depthOf,
  duplicateNames,
  fromProject,
  fromText,
  importReleases,
  importRows,
  indent,
  isWithin,
  linkToProject,
  loopNeeds,
  moveDown,
  moveFeature,
  moveUp,
  neededBy,
  outdent,
  outsidePath,
  planInto,
  removeFeature,
  removeNeed,
  removeRelease,
  renameFeature,
  renameRelease,
  setIncluded,
  settleSuggestions,
  shiftRelease,
  shipOrder,
  shipsBeforeParent,
  suggestionCount,
  toAiRows,
  toMarkdown,
  PLAYGROUND_EXAMPLE,
  type DraftFeature,
  type DraftRelease,
  type Place,
} from '@/lib/playground'
import {
  fetchProjectForPlayground,
  fetchSavedPlayground,
  savePlayground,
  usePlaygroundAi,
  usePlaygroundDraft,
  usePlaygroundImport,
  usePlaygroundPreview,
  useProjects,
  type PlaygroundImportBody,
} from '@/lib/queries'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@/lib/router'
import { AI_INSTRUCTIONS } from '@/lib/ai-instructions'
import { ApiError } from '@/lib/api'
import { cn, plural } from '@/lib/utils'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { PlaygroundImportResult } from '@/lib/types'

/**
 * The playground: a list of feature names to look at, reshape and then import
 * into a project, new or existing.
 *
 * It is names, nesting and dependencies — no code files. A list gets here by
 * asking the AI, from a file (a repository scan writes one), from pasted text,
 * by opening a project, or by typing. Nothing touches a project until Import.
 *
 * Each person has one playground, kept on the server and saved as they work,
 * so it is there on any browser they sign in from and nobody else sees it.
 * A list opened from a project remembers which feature each row is, so an
 * import back into that project renames and moves them rather than adding.
 *
 * The AI's dependencies are guesses, so they arrive as suggestions: drawn
 * dashed, and left out of an import until someone confirms them.
 *
 * Releases can be drafted here too: features are dragged into releases, and a
 * second view reads the plan back as what each release adds. An import sends
 * the releases too: the project gets the ones it lacks, and the features are
 * planned into them.
 */

/** Where drafts lived before they were kept on the server. Read once, then cleared. */
const LEGACY_STORAGE_KEY = 'featureplus.playground'
const HISTORY_LIMIT = 50
const SAVE_DELAY = 700

interface Saved {
  name: string
  items: DraftFeature[]
  releases: DraftRelease[]
  chat: Turn[]
  /** The project the list is tied to: opened from it, or imported into it. */
  source: Source | null
}

interface Source {
  id: number
  name: string
}

/** One line of the conversation with the AI. */
interface Turn {
  from: 'you' | 'ai'
  text: string
}

const CHAT_LIMIT = 30

/** One step of undo: the list and the releases together, since a release edit can change both. */
interface Snapshot {
  items: DraftFeature[]
  releases: DraftRelease[]
}

type View = 'board' | 'releases' | 'changes'

const EMPTY: Saved = { name: '', items: [], releases: [], chat: [], source: null }

/** Read a saved playground, whatever shape an older version left it in. */
function readSaved(value: unknown): Saved | null {
  if (!value || typeof value !== 'object') return null
  const saved = value as Partial<Saved>
  if (!Array.isArray(saved.items)) return null
  return {
    name: typeof saved.name === 'string' ? saved.name : '',
    items: saved.items,
    releases: Array.isArray(saved.releases) ? saved.releases : [],
    chat: Array.isArray(saved.chat) ? saved.chat : [],
    source: saved.source && typeof saved.source.id === 'number' ? saved.source : null,
  }
}

/** A draft from before drafts were kept on the server, if this browser has one. */
function legacyDraft(): Saved | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? readSaved(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function forgetLegacyDraft() {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Nothing to do: it is read only when the server has no draft.
  }
}

/** The first `# Heading` of a file, used as the suggested project name. */
function headingOf(text: string) {
  // The AI-draft marker can come back as a heading too; it is not the name.
  for (const match of text.matchAll(/^#\s+(.+)$/gm)) {
    const heading = match[1].trim()
    if (heading.toLowerCase() !== AI_DRAFT_MARKER.toLowerCase()) return heading
  }
  return ''
}

/**
 * Loads the person's saved playground, then shows it. A draft this browser
 * kept before drafts moved to the server is taken over the first time.
 */
export function Playground() {
  const saved = useQuery({
    queryKey: ['playground-saved'],
    queryFn: fetchSavedPlayground,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  if (saved.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    )
  }

  const fromServer = saved.isSuccess ? readSaved(saved.data.draft) : null
  const legacy = fromServer ? null : legacyDraft()
  return (
    <PlaygroundEditor
      initial={fromServer ?? legacy ?? EMPTY}
      takeOver={legacy !== null}
      offline={saved.isError}
    />
  )
}

type SaveState = 'saved' | 'waiting' | 'saving' | 'failed'

function PlaygroundEditor({ initial, takeOver, offline }: { initial: Saved; takeOver: boolean; offline: boolean }) {
  const { navigate } = useRouter()

  const [items, setItems] = useState<DraftFeature[]>(initial.items)
  const [releases, setReleases] = useState<DraftRelease[]>(initial.releases)
  const [name, setName] = useState(initial.name)
  const [chat, setChat] = useState<Turn[]>(initial.chat)
  const [source, setSource] = useState<Source | null>(initial.source)
  const [saveState, setSaveState] = useState<SaveState>(offline ? 'failed' : 'saved')
  const [opening, setOpening] = useState(false)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [view, setView] = useState<View>('board')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [receipt, setReceipt] = useState<{ result: PlaygroundImportResult; projectName: string } | null>(null)
  // Rows the chosen project already has, as the import panel's dry run found.
  const [existing, setExisting] = useState<Set<string>>(new Set())

  // Save a moment after the last change, and once more on the way out if a
  // save is still waiting, so leaving the page straight after an edit keeps it.
  const latest = useRef<Saved>(initial)
  latest.current = { name, items, releases, chat, source }
  const timer = useRef<number | null>(null)
  const firstRun = useRef(true)

  function flush() {
    timer.current = null
    setSaveState('saving')
    savePlayground(latest.current)
      .then(() => {
        setSaveState('saved')
        forgetLegacyDraft()
      })
      .catch(() => setSaveState('failed'))
  }

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      // Nothing changed yet, unless an old browser-only draft is moving over.
      if (!takeOver) return
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    setSaveState('waiting')
    timer.current = window.setTimeout(flush, SAVE_DELAY)
    // flush reads the latest state through a ref, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, items, releases, chat, source])

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        void savePlayground(latest.current).catch(() => undefined)
      }
    },
    [],
  )

  /** Every edit goes through here, so each one can be undone. */
  function commit(nextItems: DraftFeature[], nextReleases: DraftRelease[] = releases) {
    if (nextItems === items && nextReleases === releases) return
    setHistory((past) => [...past.slice(-(HISTORY_LIMIT - 1)), { items, releases }])
    setItems(nextItems)
    setReleases(nextReleases)
    setReceipt(null)
  }

  function change(next: DraftFeature[]) {
    commit(next)
  }

  function undo() {
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory((past) => past.slice(0, -1))
    setItems(previous.items)
    setReleases(previous.releases)
  }

  function loadText(text: string, mode: 'replace' | 'append') {
    const parsed = fromText(text)
    setProblems(parsed.problems)
    if (parsed.items.length === 0) return
    change(mode === 'replace' ? parsed.items : [...items, ...parsed.items])
    if (mode === 'replace' || !name) setName(headingOf(text))
    setSelected(null)
  }

  async function openFile(file: File | undefined) {
    if (!file) return
    loadText(await file.text(), 'replace')
  }

  function download() {
    const blob = new Blob([toMarkdown(items, name || 'Features')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(name || 'features').replace(/[^\w.-]+/g, '-').toLowerCase()}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function openProject(projectId: number) {
    setOpening(true)
    try {
      const opened = await fetchProjectForPlayground(projectId)
      const list = fromProject(opened)
      commit(list.items, list.releases)
      setName(opened.project.name)
      setSource({ id: opened.project.id, name: opened.project.name })
      setSelected(null)
      setProblems([])
      setView('board')
    } catch (err) {
      setProblems([`Could not open that project: ${err instanceof ApiError ? err.message : 'the server did not answer'}`])
    } finally {
      setOpening(false)
    }
  }

  /** After an import, the list stays tied to the project it went into. */
  function imported(receipt: { result: PlaygroundImportResult; projectName: string }) {
    setReceipt(receipt)
    setItems((current) => linkToProject(current, receipt.result.items))
    setSource({ id: receipt.result.project_id, name: receipt.projectName })
  }

  const drafter = usePlaygroundDraft()
  const ai = usePlaygroundAi()

  function say(turn: Turn) {
    setChat((past) => [...past, turn].slice(-CHAT_LIMIT))
  }

  async function ask(prompt: string) {
    say({ from: 'you', text: prompt })
    try {
      const answer = await drafter.mutateAsync({ prompt, features: toAiRows(items) })
      // An empty answer to a list that has rows is a failure, not a request to clear it.
      if (answer.features.length > 0 || items.length === 0) {
        change(applyAiRows(items, answer.features))
      }
      if (answer.title && !name) setName(answer.title)
      setProblems([])
      say({ from: 'ai', text: answer.message })
    } catch (err) {
      say({ from: 'ai', text: `Something went wrong: ${err instanceof ApiError ? err.message : 'could not reach the server'}` })
    }
  }

  const included = items.filter((item) => item.include).length
  const changedSinceOpened = useMemo(() => changedFromProject(items), [items])
  const suggestions = useMemo(() => suggestionCount(items), [items])
  const loops = useMemo(() => loopNeeds(items), [items])
  const duplicates = useMemo(() => duplicateNames(items.filter((item) => item.include)), [items])
  const releaseNames = useMemo(() => {
    const names = new Map(releases.map((release) => [release.key, release.name]))
    const labels = new Map<string, string>()
    for (const item of items) {
      const label = item.release ? names.get(item.release) : undefined
      if (label) labels.set(item.key, label)
    }
    return labels
  }, [items, releases])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Playground</h2>
            <SaveIndicator state={saveState} onRetry={flush} />
          </div>
          <p className="mt-0.5 max-w-2xl text-sm text-muted">
            Draft features with the AI or open a project, reshape them, plan releases, and import. Nothing
            here touches a project until you import.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <OpenProjectPicker busy={opening} onOpen={openProject} />
          <FileButton onFile={openFile} />
          <CopyInstructionsButton />
          <Button variant="secondary" size="sm" onClick={() => setPasting(true)}>
            <ClipboardPaste className="h-3.5 w-3.5" />
            Paste
          </Button>
          <Button variant="secondary" size="sm" onClick={download} disabled={items.length === 0}>
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
          <Button variant="ghost" size="sm" onClick={undo} disabled={history.length === 0}>
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </Button>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                commit([], [])
                setName('')
                setSource(null)
                setProblems([])
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <AskPanel
        chat={chat}
        connected={ai.data?.connected ?? false}
        model={ai.data?.drafter ?? ''}
        hasItems={items.length > 0}
        busy={drafter.isPending}
        onAsk={ask}
        onClear={() => setChat([])}
      />

      {suggestions > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-accent/50 bg-accent-soft px-3 py-2 text-xs text-ink">
          <p>
            <span className="font-medium">The AI suggested {plural(suggestions, 'dependency', 'dependencies')}.</span>{' '}
            <span className="text-muted">
              They are dashed, and left out of an import until you confirm them. Select a feature to check
              them one by one.
            </span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => change(settleSuggestions(items, false))}>
              Dismiss all
            </Button>
            <Button size="sm" variant="secondary" onClick={() => change(settleSuggestions(items, true))}>
              <Check className="h-3.5 w-3.5" />
              Confirm all
            </Button>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <div>
            <p className="font-medium">
              {plural(problems.length, 'line was', 'lines were')} skipped while reading that:
            </p>
            <ul className="mt-1 list-disc pl-4">
              {problems.slice(0, 5).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
          <button onClick={() => setProblems([])} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {source && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-raised/60 px-3 py-2 text-xs">
          <p className="text-muted">
            Tied to <span className="font-medium text-ink">{source.name}</span>
            {changedSinceOpened > 0
              ? ` · ${plural(changedSinceOpened, 'feature')} renamed or moved here; Import writes ${
                  changedSinceOpened === 1 ? 'it' : 'them'
                } back to the same features.`
              : ' · Import renames and moves these same features rather than adding new ones.'}{' '}
            Import never deletes anything.
          </p>
          <Button size="sm" variant="ghost" onClick={() => void openProject(source.id)} loading={opening}>
            Reload from the project
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          busy={opening}
          onOpenProject={openProject}
          onExample={() => loadText(PLAYGROUND_EXAMPLE, 'replace')}
          onAdd={(title) => change(addFeature(items, title))}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <FeatureList
              items={items}
              selected={selected}
              editing={editing}
              duplicates={duplicates}
              existing={existing}
              releaseNames={releaseNames}
              loops={loops}
              onSelect={setSelected}
              onEdit={setEditing}
              onChange={change}
              summary={`${included} of ${plural(items.length, 'feature')} ticked`}
            />
            {selected && items.some((item) => item.key === selected) && (
              <NeedsPanel items={items} selected={selected} loops={loops} onSelect={setSelected} onChange={change} />
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <ImportPanel
              items={items}
              releases={releases}
              listName={name}
              source={source}
              duplicates={duplicates}
              receipt={receipt}
              onImported={imported}
              onExisting={setExisting}
              onOpenProject={(projectId) => navigate({ name: 'project', projectId })}
              onOpenCanvas={(projectId) => navigate({ name: 'dependencies', projectId })}
            />
            <ViewSwitch view={view} onView={setView} releases={releases.length} />
            {view === 'board' && (
              <Board
                items={items}
                selected={selected}
                existing={existing}
                loops={loops}
                onSelect={setSelected}
                onMove={(key, target, place) => change(moveFeature(items, key, target, place))}
              />
            )}
            {view === 'releases' && (
              <ReleasePlanner
                items={items}
                releases={releases}
                selected={selected}
                onSelect={setSelected}
                onPlan={(key, release) => change(planInto(items, key, release))}
                onAdd={() => commit(items, addRelease(releases))}
                onRename={(key, title) => commit(items, renameRelease(releases, key, title))}
                onShift={(key, step) => commit(items, shiftRelease(releases, key, step))}
                onRemove={(key) => {
                  const next = removeRelease(items, releases, key)
                  commit(next.items, next.releases)
                }}
              />
            )}
            {view === 'changes' && (
              <ReleaseChanges items={items} releases={releases} onPlan={() => setView('releases')} />
            )}
          </div>
        </div>
      )}

      {pasting && (
        <PasteDialog
          hasItems={items.length > 0}
          onClose={() => setPasting(false)}
          onSubmit={(text, mode) => {
            loadText(text, mode)
            setPasting(false)
          }}
        />
      )}
    </div>
  )
}

// ---------- the list ----------

function FeatureList({
  items,
  selected,
  editing,
  duplicates,
  existing,
  releaseNames,
  loops,
  onSelect,
  onEdit,
  onChange,
  summary,
}: {
  items: DraftFeature[]
  selected: string | null
  editing: string | null
  duplicates: Set<string>
  existing: Set<string>
  releaseNames: Map<string, string>
  loops: Set<string>
  onSelect: (key: string | null) => void
  onEdit: (key: string | null) => void
  onChange: (next: DraftFeature[]) => void
  summary: string
}) {
  const [newTitle, setNewTitle] = useState('')
  const [drag, setDrag] = useState<{ key: string; over: string | null; place: Place } | null>(null)

  function add() {
    const title = newTitle.trim()
    if (!title) return
    onChange(addFeature(items, title))
    setNewTitle('')
  }

  function rowKeys(event: KeyboardEvent<HTMLDivElement>, key: string) {
    if (editing === key) return
    const act = (next: DraftFeature[]) => {
      event.preventDefault()
      onChange(next)
    }

    if (event.altKey && event.key === 'ArrowUp') return act(moveUp(items, key))
    if (event.altKey && event.key === 'ArrowDown') return act(moveDown(items, key))
    if (event.key === 'Tab' && !event.shiftKey) return act(indent(items, key))
    if (event.key === 'Tab' && event.shiftKey) return act(outdent(items, key))
    if (event.key === 'Delete') return act(removeFeature(items, key))
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      onEdit(key)
    }
    if (event.key === ' ') {
      const row = items.find((item) => item.key === key)
      if (row) act(setIncluded(items, key, !row.include))
    }
  }

  function dragOver(event: DragEvent<HTMLDivElement>, key: string) {
    if (!drag || isWithin(items, key, drag.key)) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const y = (event.clientY - rect.top) / rect.height
    const place: Place = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
    if (drag.over !== key || drag.place !== place) setDrag({ ...drag, over: key, place })
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (drag?.over) onChange(moveFeature(items, drag.key, drag.over, drag.place))
    setDrag(null)
  }

  return (
    <Card className="flex min-h-[420px] flex-col">
      <CardHeader>
        <CardTitle>
          Features
          <span className="ml-2 font-normal text-faint">{summary}</span>
        </CardTitle>
      </CardHeader>

      <div className="max-h-[60vh] flex-1 overflow-y-auto py-1" role="tree" aria-label="Features">
        {items.map((item) => {
          const depth = depthOf(items, item.key)
          const children = childrenOf(items, item.key).length
          const dropping = drag?.over === item.key
          const duplicate = item.include && duplicates.has(item.title.trim().toLowerCase())
          const needs = item.needs ?? []
          const suggested = needs.filter((need) => need.suggested).length
          const looped = needs.some((need) => loops.has(`${item.key}>${need.key}`))

          return (
            <div
              key={item.key}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selected === item.key}
              tabIndex={0}
              draggable={editing !== item.key}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                setDrag({ key: item.key, over: null, place: 'inside' })
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(event) => dragOver(event, item.key)}
              onDrop={drop}
              onFocus={() => onSelect(item.key)}
              onClick={() => onSelect(item.key)}
              onKeyDown={(event) => rowKeys(event, item.key)}
              className={cn(
                'group relative flex items-center gap-1.5 py-1 pr-2 text-sm outline-none',
                selected === item.key ? 'bg-accent-soft' : 'hover:bg-raised',
                drag?.key === item.key && 'opacity-40',
                dropping && drag?.place === 'inside' && 'ring-2 ring-inset ring-accent',
              )}
              style={{ paddingLeft: 8 + depth * 20 }}
            >
              {dropping && drag?.place !== 'inside' && (
                <span
                  className={cn(
                    'pointer-events-none absolute left-2 right-2 h-0.5 rounded bg-accent',
                    drag?.place === 'before' ? 'top-0' : 'bottom-0',
                  )}
                />
              )}

              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100" />
              <input
                type="checkbox"
                checked={item.include}
                onChange={(event) => onChange(setIncluded(items, item.key, event.target.checked))}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Include ${item.title}`}
                className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--accent))]"
              />

              {editing === item.key ? (
                <TitleEditor
                  value={item.title}
                  onDone={(title) => {
                    onEdit(null)
                    if (title.trim() && title !== item.title) onChange(renameFeature(items, item.key, title.trim()))
                  }}
                />
              ) : (
                <button
                  className={cn(
                    'min-w-0 flex-1 truncate text-left',
                    item.include ? 'text-ink' : 'text-faint line-through',
                    children > 0 && 'font-medium',
                  )}
                  onDoubleClick={() => onEdit(item.key)}
                  title="Double-click to rename"
                >
                  {item.title || <span className="italic text-faint">Untitled</span>}
                </button>
              )}

              {children > 0 && editing !== item.key && (
                <span className="text-2xs text-faint">{children}</span>
              )}
              {item.include && releaseNames.has(item.key) && (
                <Badge tone="accent" title="Planned into this release">
                  {releaseNames.get(item.key)}
                </Badge>
              )}
              {needs.length > 0 && editing !== item.key && (
                <span
                  title={`Needs ${needs.length}${suggested > 0 ? `, ${suggested} of them suggested by the AI` : ''}`}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-2xs',
                    suggested > 0 ? 'border-dashed border-accent/60 text-accent' : 'border-border text-muted',
                  )}
                >
                  <Link2 className="h-3 w-3" />
                  {needs.length}
                </span>
              )}
              {looped && <Badge tone="danger">loop</Badge>}
              {duplicate && <Badge tone="danger">twice</Badge>}
              {item.include && existing.has(item.key) && <Badge tone="neutral">already there</Badge>}

              {editing !== item.key && (
                <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  <RowAction label="Add inside" onClick={() => onChange(addFeature(items, 'New feature', item.key))}>
                    <Plus className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction label="Move up (Alt+↑)" onClick={() => onChange(moveUp(items, item.key))}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction label="Move down (Alt+↓)" onClick={() => onChange(moveDown(items, item.key))}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction label="Take out of parent (Shift+Tab)" onClick={() => onChange(outdent(items, item.key))}>
                    <IndentDecrease className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction label="Put inside the one above (Tab)" onClick={() => onChange(indent(items, item.key))}>
                    <IndentIncrease className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction
                    label={children > 0 ? 'Delete with everything inside' : 'Delete'}
                    onClick={() => onChange(removeFeature(items, item.key))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </RowAction>
                </div>
              )}
            </div>
          )
        })}

        {/* Dropping here takes a feature out to the top level, at the end. */}
        {drag && (
          <div
            onDragOver={(event) => {
              event.preventDefault()
              if (drag.over !== null) setDrag({ ...drag, over: null })
            }}
            onDrop={(event) => {
              event.preventDefault()
              onChange(moveFeature(items, drag.key, null, 'after'))
              setDrag(null)
            }}
            className="mx-2 mt-1 rounded-md border border-dashed border-border py-2 text-center text-2xs text-faint"
          >
            Drop here to move to the top level
          </div>
        )}
      </div>

      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="Add a feature…"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!newTitle.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </form>
      <p className="px-3 pb-3 text-2xs text-faint">
        Double-click to rename · drag onto a feature to nest it · Tab / Shift+Tab to nest and un-nest
      </p>
    </Card>
  )
}

function TitleEditor({ value, onDone }: { value: string; onDone: (title: string) => void }) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onDone(text)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') onDone(text)
        if (event.key === 'Escape') onDone(value)
      }}
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-sm text-ink focus:outline-none"
    />
  )
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  )
}

// ---------- the board ----------

/**
 * The same list drawn as cards, so its shape can be taken in at a glance: a
 * feature with anything inside it is a box around its parts. Cards can be
 * dragged into one another here as well.
 */
function Board({
  items,
  selected,
  existing,
  loops,
  onSelect,
  onMove,
}: {
  items: DraftFeature[]
  selected: string | null
  existing: Set<string>
  loops: Set<string>
  onSelect: (key: string) => void
  onMove: (key: string, target: string | null, place: Place) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const top = childrenOf(items, null)
  const titles = new Map(items.map((item) => [item.key, item.title || 'Untitled']))

  /** "needs Sign in, Cart" under a card, with the AI's guesses dashed. */
  function needsLine(item: DraftFeature) {
    const needs = item.needs ?? []
    if (needs.length === 0) return null
    return (
      <p className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-faint">
        <span>needs</span>
        {needs.map((need) => (
          <span
            key={need.key}
            className={cn(
              'rounded border px-1',
              need.suggested ? 'border-dashed border-accent/60 text-accent' : 'border-border text-muted',
              loops.has(`${item.key}>${need.key}`) && 'border-danger text-danger',
            )}
          >
            {titles.get(need.key) ?? '?'}
          </span>
        ))}
      </p>
    )
  }

  function node(item: DraftFeature): ReactNode {
    const children = childrenOf(items, item.key)
    const canDrop = dragging !== null && !isWithin(items, item.key, dragging)

    const handlers = {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.stopPropagation()
        event.dataTransfer.effectAllowed = 'move'
        setDragging(item.key)
      },
      onDragEnd: () => {
        setDragging(null)
        setOver(null)
      },
      onDragOver: (event: DragEvent) => {
        if (!canDrop) return
        event.preventDefault()
        event.stopPropagation()
        setOver(item.key)
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        event.stopPropagation()
        if (dragging && canDrop) onMove(dragging, item.key, 'inside')
        setDragging(null)
        setOver(null)
      },
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        onSelect(item.key)
      },
    }

    const marks = (
      <>
        {existing.has(item.key) && item.include && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted" title="Already in the project" />
        )}
      </>
    )

    const tone = cn(
      'cursor-pointer transition-colors',
      !item.include && 'border-dashed opacity-45',
      selected === item.key ? 'border-accent ring-1 ring-accent' : 'border-border',
      over === item.key && 'border-accent bg-accent-soft',
      dragging === item.key && 'opacity-30',
    )

    if (children.length === 0) {
      return (
        <div
          key={item.key}
          {...handlers}
          className={cn('rounded-md border bg-surface px-2.5 py-1.5 text-xs text-ink shadow-card', tone)}
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate">{item.title || 'Untitled'}</span>
            {marks}
          </div>
          {needsLine(item)}
        </div>
      )
    }

    return (
      <div key={item.key} {...handlers} className={cn('rounded-lg border bg-raised/60 p-2', tone)}>
        <div className="mb-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-ink">{item.title || 'Untitled'}</span>
            <span className="text-2xs text-faint">{children.length}</span>
            {marks}
          </div>
          {needsLine(item)}
        </div>
        <div className="flex flex-wrap gap-1.5">{children.map(node)}</div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Board
          <span className="ml-2 font-normal text-faint">
            {plural(top.length, 'top-level feature')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody>
        <div
          className={cn(
            'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-3 rounded-md p-1',
            dragging && over === null && 'bg-accent-soft/40',
          )}
          onDragOver={(event) => {
            if (!dragging) return
            event.preventDefault()
            setOver(null)
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (dragging) onMove(dragging, null, 'after')
            setDragging(null)
          }}
        >
          {top.map(node)}
        </div>
        <p className="mt-3 text-2xs text-faint">
          Drag a card onto another to put it inside; drop it on the empty board to bring it to the top
          level. Dashed cards are unticked and will not be imported. Dashed dependencies are the AI's
          suggestions.
        </p>
      </CardBody>
    </Card>
  )
}

// ---------- releases ----------

function ViewSwitch({ view, onView, releases }: { view: View; onView: (view: View) => void; releases: number }) {
  const options: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'board', label: 'Board', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { id: 'releases', label: 'Plan releases', icon: <Milestone className="h-3.5 w-3.5" /> },
    { id: 'changes', label: 'What changed', icon: <History className="h-3.5 w-3.5" /> },
  ]

  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-md border border-border bg-raised p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          role="tab"
          aria-selected={view === option.id}
          onClick={() => onView(option.id)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors',
            view === option.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {option.icon}
          {option.label}
          {option.id === 'releases' && releases > 0 && <span className="text-2xs text-faint">{releases}</span>}
        </button>
      ))}
    </div>
  )
}

const NOT_PLANNED = '__not-planned'

/**
 * Releases as columns, first to ship on the left, with a column of everything
 * not planned yet. Dragging a feature into a column plans it, with everything
 * inside it; only ticked features take part, since only they will be imported.
 */
function ReleasePlanner({
  items,
  releases,
  selected,
  onSelect,
  onPlan,
  onAdd,
  onRename,
  onShift,
  onRemove,
}: {
  items: DraftFeature[]
  releases: DraftRelease[]
  selected: string | null
  onSelect: (key: string) => void
  onPlan: (key: string, release: string | null) => void
  onAdd: () => void
  onRename: (key: string, name: string) => void
  onShift: (key: string, step: -1 | 1) => void
  onRemove: (key: string) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const order = useMemo(() => shipOrder(items, releases), [items, releases])
  const early = useMemo(() => shipsBeforeParent(items, releases), [items, releases])
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])
  const ticked = items.filter((item) => item.include)

  const columnOf = (key: string) => {
    const index = order.get(key) ?? -1
    return index === -1 ? NOT_PLANNED : releases[index].key
  }

  const columns: { key: string; name: string; index: number; published?: boolean }[] = [
    { key: NOT_PLANNED, name: 'Not planned', index: -1 },
    ...releases.map((release, index) => ({ key: release.key, name: release.name, index, published: release.published })),
  ]

  function column(col: { key: string; name: string; index: number; published?: boolean }) {
    const rows = ticked.filter((item) => columnOf(item.key) === col.key)
    const inColumn = (key: string) => columnOf(key) === col.key && byKey.get(key)?.include === true
    const planned = col.key !== NOT_PLANNED

    return (
      <div
        key={col.key}
        onDragOver={(event) => {
          if (!dragging) return
          event.preventDefault()
          if (over !== col.key) setOver(col.key)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (dragging) onPlan(dragging, planned ? col.key : null)
          setDragging(null)
          setOver(null)
        }}
        className={cn(
          'flex w-60 shrink-0 flex-col rounded-lg border transition-colors',
          planned ? 'border-border bg-raised/60' : 'border-dashed border-border bg-surface',
          over === col.key && 'border-accent bg-accent-soft',
        )}
      >
        <div className="group flex items-center gap-1.5 border-b border-border px-2.5 py-2">
          {planned && <Milestone className="h-3.5 w-3.5 shrink-0 text-accent" />}
          {renaming === col.key ? (
            <TitleEditor
              value={col.name}
              onDone={(name) => {
                setRenaming(null)
                if (name.trim() && name !== col.name) onRename(col.key, name.trim())
              }}
            />
          ) : (
            <button
              className={cn('min-w-0 flex-1 truncate text-left text-xs font-semibold', planned ? 'text-ink' : 'text-muted')}
              onDoubleClick={() => planned && setRenaming(col.key)}
              title={planned ? 'Double-click to rename' : undefined}
            >
              {col.name}
            </button>
          )}
          {col.published && (
            <Badge tone="neutral" title="Already published: an import leaves this release as it is">
              published
            </Badge>
          )}
          <span className="text-2xs text-faint">{rows.length}</span>
          {planned && renaming !== col.key && (
            <div className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <RowAction label="Ship earlier" onClick={() => onShift(col.key, -1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </RowAction>
              <RowAction label="Ship later" onClick={() => onShift(col.key, 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </RowAction>
              <RowAction label="Delete the release (its features go back to not planned)" onClick={() => onRemove(col.key)}>
                <Trash2 className="h-3.5 w-3.5" />
              </RowAction>
            </div>
          )}
        </div>

        <div className="max-h-[520px] min-h-[120px] flex-1 space-y-1.5 overflow-y-auto p-2">
          {rows.length === 0 && (
            <p className="px-1 py-6 text-center text-2xs text-faint">
              {planned ? 'Drag features here' : 'Everything is planned'}
            </p>
          )}
          {rows.map((row) => {
            const { path, depth } = outsidePath(items, row.key, inColumn)
            const parent = early.get(row.key)
            return (
              <div
                key={row.key}
                draggable
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging(row.key)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
                onClick={() => onSelect(row.key)}
                style={{ marginLeft: depth * 12 }}
                className={cn(
                  'cursor-grab rounded-md border bg-surface px-2.5 py-1.5 shadow-card',
                  selected === row.key ? 'border-accent ring-1 ring-accent' : 'border-border',
                  dragging === row.key && 'opacity-30',
                )}
              >
                {path.length > 0 && <p className="truncate text-2xs text-faint">{path.join(' › ')} ›</p>}
                <p className="truncate text-xs text-ink">{row.title || 'Untitled'}</p>
                {parent && (
                  <p className="mt-1 text-2xs text-warning">
                    Ships before {byKey.get(parent)?.title || 'its parent'}, which it sits inside
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Plan releases
          <span className="ml-2 font-normal text-faint">
            {releases.length === 0 ? 'no releases yet' : plural(releases.length, 'release')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody>
        <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
          {columns.map(column)}
          <button
            onClick={onAdd}
            className="flex w-40 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Plus className="h-4 w-4" />
            New release
          </button>
        </div>
        <p className="mt-3 text-2xs text-faint">
          Drag a feature into a release and everything inside it comes along; drag a part on its own to ship
          it later. Releases ship left to right. Unticked features are left out. Import creates these
          releases in the project and plans the features into them.
        </p>
      </CardBody>
    </Card>
  )
}

/**
 * The plan read back one release at a time: what it adds, and what the
 * product holds once it is out. Nothing here edits — it is the same labels the
 * planner sets, turned into a history that has not happened yet.
 */
function ReleaseChanges({
  items,
  releases,
  onPlan,
}: {
  items: DraftFeature[]
  releases: DraftRelease[]
  onPlan: () => void
}) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [showLater, setShowLater] = useState(false)

  const order = useMemo(() => shipOrder(items, releases), [items, releases])
  const early = useMemo(() => shipsBeforeParent(items, releases), [items, releases])
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])
  const ticked = useMemo(() => items.filter((item) => item.include), [items])

  if (releases.length === 0) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <History className="h-5 w-5 text-faint" />
          <p className="max-w-sm text-sm text-muted">
            Once features are planned into releases, this shows what each release adds and what the product
            looks like after it.
          </p>
          <Button size="sm" onClick={onPlan}>
            Plan releases
          </Button>
        </CardBody>
      </Card>
    )
  }

  const shipIndex = (key: string) => order.get(key) ?? -1
  const stats = releases.map((release, index) => ({
    release,
    index,
    added: ticked.filter((item) => shipIndex(item.key) === index),
    total: ticked.filter((item) => shipIndex(item.key) !== -1 && shipIndex(item.key) <= index).length,
  }))
  const notPlanned = ticked.filter((item) => shipIndex(item.key) === -1).length
  const current = stats.find((stat) => stat.release.key === chosen) ?? stats[0]
  const previous = current.index > 0 ? releases[current.index - 1] : null

  const inCurrent = (key: string) => shipIndex(key) === current.index && byKey.get(key)?.include === true
  const shipsIn = (key: string) => {
    const index = shipIndex(key)
    return index === -1 ? null : releases[index].name
  }

  /** The nearest feature above a row that is not part of this release. */
  function outsideParent(key: string) {
    let parent = byKey.get(key)?.parent ?? null
    while (parent !== null && inCurrent(parent)) parent = byKey.get(parent)?.parent ?? null
    return parent === null ? null : (byKey.get(parent) ?? null)
  }

  // Features not out yet stay on the product view as faded context when
  // something inside them is out, so a shipped part never floats on its own.
  const shipped = (key: string) => shipIndex(key) !== -1 && shipIndex(key) <= current.index
  const context = new Set<string>()
  for (const item of ticked) {
    if (!shipped(item.key)) continue
    let parent = item.parent
    while (parent !== null) {
      context.add(parent)
      parent = byKey.get(parent)?.parent ?? null
    }
  }
  const productRows = ticked.filter((item) => shipped(item.key) || context.has(item.key) || showLater)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          What changed
          <span className="ml-2 font-normal text-faint">release by release</span>
        </CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
          <ol aria-label="Releases" className="space-y-0.5">
            {stats.map((stat, position) => {
              const active = stat.release.key === current.release.key
              return (
                <li key={stat.release.key} className="relative pl-6">
                  {position < stats.length - 1 && (
                    <span className="absolute left-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />
                  )}
                  <span
                    className={cn(
                      'absolute left-[3px] top-[11px] h-2.5 w-2.5 rounded-full border-2',
                      active ? 'border-accent bg-accent' : 'border-border bg-surface',
                    )}
                    aria-hidden="true"
                  />
                  <button
                    onClick={() => setChosen(stat.release.key)}
                    aria-current={active}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-accent-soft' : 'hover:bg-raised',
                    )}
                  >
                    <span className={cn('block truncate text-sm font-medium', active ? 'text-accent' : 'text-ink')}>
                      {stat.release.name}
                    </span>
                    <span className="block text-2xs text-muted">
                      +{stat.added.length} new · {stat.total} in total
                    </span>
                  </button>
                </li>
              )
            })}
            {notPlanned > 0 && (
              <li className="pl-6 pt-2 text-2xs text-faint">{plural(notPlanned, 'feature')} not planned yet</li>
            )}
          </ol>

          <div className="min-w-0 space-y-5">
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-base font-semibold text-ink">{current.release.name}</h3>
                <Badge tone="success">+{current.added.length} new</Badge>
                <span className="text-xs text-muted">
                  {plural(current.total, 'feature')} in the product after this release
                  {previous && ` · ${current.total - current.added.length} came before, up to ${previous.name}`}
                </span>
              </div>
            </div>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">New in this release</h4>
              {current.added.length === 0 ? (
                <p className="text-sm text-muted">Nothing is planned into {current.release.name} yet.</p>
              ) : (
                <ul className="space-y-1">
                  {current.added.map((row) => {
                    const { depth } = outsidePath(items, row.key, inCurrent)
                    const parent = depth === 0 ? outsideParent(row.key) : null
                    const parentShips = parent ? shipsIn(parent.key) : null
                    return (
                      <li
                        key={row.key}
                        style={{ paddingLeft: depth * 18 }}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-success" />
                        <span className="text-ink">{row.title || 'Untitled'}</span>
                        {parent && (
                          <span className="text-xs text-muted">
                            adds to {parent.title || 'Untitled'}
                            {parentShips ? ` (${parentShips})` : ' (not planned)'}
                          </span>
                        )}
                        {early.has(row.key) && <Badge tone="warning">before its parent</Badge>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-faint">
                  The product after {current.release.name}
                </h4>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={showLater}
                    onChange={(event) => setShowLater(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
                  />
                  Show what comes later
                </label>
              </div>
              <ul className="space-y-0.5 rounded-md border border-border p-2">
                {productRows.map((row) => {
                  const index = shipIndex(row.key)
                  const isNew = index === current.index
                  const isOut = shipped(row.key)
                  return (
                    <li
                      key={row.key}
                      style={{ paddingLeft: 4 + depthOf(items, row.key) * 18 }}
                      className={cn(
                        'flex items-center gap-2 rounded py-0.5 pr-1 text-sm',
                        isNew && 'bg-success-soft',
                        !isOut && 'text-faint',
                      )}
                    >
                      <span className={cn('truncate', isOut ? 'text-ink' : 'text-faint')}>{row.title || 'Untitled'}</span>
                      {isNew && <Badge tone="success">new</Badge>}
                      {!isOut && (
                        <span className="shrink-0 text-2xs">
                          {index === -1 ? 'not planned' : `in ${releases[index].name}`}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------- import ----------

function ImportPanel({
  items,
  releases,
  listName,
  source,
  duplicates,
  receipt,
  onImported,
  onExisting,
  onOpenProject,
  onOpenCanvas,
}: {
  items: DraftFeature[]
  releases: DraftRelease[]
  listName: string
  source: Source | null
  duplicates: Set<string>
  receipt: { result: PlaygroundImportResult; projectName: string } | null
  onImported: (receipt: { result: PlaygroundImportResult; projectName: string }) => void
  onExisting: (keys: Set<string>) => void
  onOpenProject: (projectId: number) => void
  onOpenCanvas: (projectId: number) => void
}) {
  const projects = useProjects({ per_page: 200 })
  const importer = usePlaygroundImport()

  const [target, setTarget] = useState<string>(source ? String(source.id) : '')
  const [newName, setNewName] = useState(listName)
  const [error, setError] = useState('')

  // A list opened from, or imported into, a project goes back there unless
  // someone picks otherwise.
  const sourceId = source?.id
  useEffect(() => {
    if (sourceId) setTarget(String(sourceId))
  }, [sourceId])

  useEffect(() => {
    if (!newName && listName) setNewName(listName)
  }, [listName, newName])

  const rows = useMemo(() => importRows(items, releases), [items, releases])
  const sentReleases = useMemo(() => importReleases(releases), [releases])
  const releaseClash = useMemo(() => {
    const seen = new Set<string>()
    return sentReleases.some((release) => {
      const name = release.name.toLowerCase()
      if (seen.has(name)) return true
      seen.add(name)
      return false
    })
  }, [sentReleases])
  const projectId = target && target !== 'new' ? Number(target) : 0

  const previewBody: PlaygroundImportBody | null =
    projectId > 0 && duplicates.size === 0 && !releaseClash
      ? { project_id: projectId, features: rows, releases: sentReleases }
      : null
  const preview = usePlaygroundPreview(previewBody)

  // Tell the list and the board which rows the project already has. Rows
  // opened from it obviously are, so only the others are marked.
  useEffect(() => {
    const keys = new Set<string>()
    if (projectId > 0) {
      const linked = new Set(items.filter((item) => item.origin).map((item) => item.key))
      for (const outcome of preview.data?.items ?? []) {
        if (outcome.outcome === 'existing' && !linked.has(outcome.key)) keys.add(outcome.key)
      }
    }
    onExisting(keys)
  }, [preview.data, projectId, onExisting, items])

  const existingCount = projectId > 0 ? (preview.data?.existing ?? 0) : 0
  const updatedCount = projectId > 0 ? (preview.data?.updated ?? 0) : 0
  const createCount = rows.length - existingCount - updatedCount
  const needCount = rows.reduce((sum, row) => sum + (row.needs?.length ?? 0), 0)
  const newNeeds = projectId > 0 ? (preview.data?.dependencies_created ?? 0) : needCount
  const unconfirmed = suggestionCount(items.filter((item) => item.include))
  // Rows opened from this project are "already there" by definition; only the
  // others are worth counting as such.
  const linkedHere = useMemo(
    () => new Set(items.filter((item) => item.origin && source?.id === projectId).map((item) => item.key)),
    [items, source, projectId],
  )
  const matchedByName = (preview.data?.items ?? []).filter(
    (outcome) => outcome.outcome === 'existing' && !linkedHere.has(outcome.key),
  ).length
  const replanned = source?.id === projectId ? replannedFromProject(items) : 0
  // A plan for features that were not opened from the project is a change
  // only the import can tell apart, so it counts while any are planned.
  const plansOthers = rows.some((row) => row.release_key && !linkedHere.has(row.key))
  const releasesNew = preview.data?.releases_created ?? 0
  const changes =
    createCount + updatedCount + replanned + releasesNew + (projectId > 0 ? newNeeds : 0) + (plansOthers ? 1 : 0)
  const upToDate = projectId > 0 && !!preview.data && changes === 0
  const updatesOnly = projectId > 0 && createCount === 0 && changes > 0

  // Re-importing a list the project already has is still worth doing when it
  // carries releases or new dependencies: that is how a re-planned list
  // reaches the project.
  const blocked =
    rows.length === 0 ||
    duplicates.size > 0 ||
    releaseClash ||
    !target ||
    (target === 'new' && !newName.trim()) ||
    (projectId > 0 && (!preview.data || upToDate))

  async function run() {
    setError('')
    const body: PlaygroundImportBody =
      target === 'new'
        ? {
            new_project: { name: newName.trim(), description: 'Imported from the playground' },
            features: rows,
            releases: sentReleases,
          }
        : { project_id: projectId, features: rows, releases: sentReleases }

    try {
      const result = await importer.mutateAsync(body)
      const projectName =
        target === 'new'
          ? newName.trim()
          : (projects.data?.items.find((p) => p.id === projectId)?.name ?? 'the project')
      onImported({ result, projectName })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  if (receipt) {
    const { result, projectName } = receipt
    return (
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              <p className="text-sm font-medium text-ink">Imported into {projectName}</p>
              <p className="mt-0.5 text-xs text-muted">
                {plural(result.created, 'feature')} created
                {result.updated > 0 && `, ${result.updated} renamed or moved`}
                {result.existing > 0 && `, ${result.existing} already there and left as they were`}.
                {(result.releases_created > 0 || result.releases_existing > 0) && (
                  <>
                    {' '}
                    {plural(result.releases_created, 'release')} created
                    {result.releases_existing > 0 && `, ${result.releases_existing} already there`}
                    {result.planned > 0 && `; ${plural(result.planned, 'feature')} planned into them`}.
                  </>
                )}
                {result.skipped_releases.length > 0 &&
                  ` ${result.skipped_releases.join(', ')} already published, so left as is.`}
                {(result.dependencies_created > 0 || result.dependencies_existing > 0) && (
                  <>
                    {' '}
                    {plural(result.dependencies_created, 'dependency', 'dependencies')} added
                    {result.dependencies_existing > 0 && `, ${result.dependencies_existing} already there`}.
                  </>
                )}{' '}
                The list stays here, tied to {projectName}, so a later import updates the same features.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => onOpenCanvas(result.project_id)}>
              Open on the canvas
            </Button>
            <Button size="sm" onClick={() => onOpenProject(result.project_id)}>
              Open project
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label htmlFor="playground-target" className="block text-xs font-medium text-muted">
              Into
            </label>
            <select
              id="playground-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="">Choose a project…</option>
              <option value="new">+ New project</option>
              {(projects.data?.items ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {target === 'new' && (
            <div className="min-w-[220px] flex-1">
              <Input label="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My project" />
            </div>
          )}

          <Button onClick={run} disabled={blocked} loading={importer.isPending}>
            {upToDate
              ? 'Up to date'
              : updatesOnly
                ? 'Update the project'
                : `Import ${rows.length > 0 && createCount > 0 ? createCount : ''}`}
          </Button>
        </div>

        <p className="text-xs text-muted">
          {duplicates.size > 0 ? (
            <span className="text-danger">
              Some names are in the list twice. Rename or untick one of each before importing.
            </span>
          ) : releaseClash ? (
            <span className="text-danger">Two releases have the same name. Rename one before importing.</span>
          ) : rows.length === 0 ? (
            'Tick at least one feature to import.'
          ) : projectId > 0 && preview.isFetching && !preview.data ? (
            'Checking what the project already has…'
          ) : upToDate ? (
            'The project already matches this list. Rename, move, re-plan or add features here, then update it.'
          ) : projectId > 0 ? (
            <>
              {plural(createCount, 'new feature')}
              {updatedCount > 0 && <> · {plural(updatedCount, 'feature')} renamed or moved</>}
              {replanned > 0 && <> · {plural(replanned, 'feature')} re-planned</>}
              {matchedByName > 0 && (
                <>
                  {' '}· {matchedByName} already there, marked in the list — those are left as they are, and
                  anything nested under them here goes inside them
                </>
              )}
              {releasesNew > 0 && <> · {plural(releasesNew, 'new release')}</>}
              {preview.data && preview.data.dependencies_created > 0 && (
                <> · {plural(preview.data.dependencies_created, 'new dependency', 'new dependencies')}</>
              )}
              .
            </>
          ) : target === 'new' ? (
            `${plural(rows.length, 'feature')}${
              sentReleases.length > 0 ? `, ${plural(sentReleases.length, 'release')}` : ''
            }${needCount > 0 ? `, ${plural(needCount, 'dependency', 'dependencies')}` : ''} into a new project.`
          ) : (
            `${plural(rows.length, 'feature')} ready. Choose where they go.`
          )}
        </p>

        {unconfirmed > 0 && (
          <p className="text-xs text-muted">
            {plural(unconfirmed, 'suggested dependency', 'suggested dependencies')} not confirmed yet, so{' '}
            {unconfirmed === 1 ? 'it is' : 'they are'} left out.
          </p>
        )}
        {preview.isError && projectId > 0 && (
          <p className="text-xs text-danger">
            {preview.error instanceof ApiError ? preview.error.message : 'Could not check the project'}
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </CardBody>
    </Card>
  )
}

// ---------- the AI ----------

const ASK_EXAMPLES = [
  'A hiking app with trails, offline maps and group trips',
  'An online shop with reviews, chat and bookings',
]

const FOLLOW_UPS = ['add Tags inside …', '… needs …', 'put … inside …', 'rename … to …', 'remove …']

/**
 * A prompt, and the conversation so far. Each answer replaces the list in one
 * step, so Undo takes it back. Until a model is connected the answers come
 * from a stand-in, and the panel says so.
 */
function AskPanel({
  chat,
  connected,
  model,
  hasItems,
  busy,
  onAsk,
  onClear,
}: {
  chat: Turn[]
  connected: boolean
  model: string
  hasItems: boolean
  busy: boolean
  onAsk: (prompt: string) => void
  onClear: () => void
}) {
  const [text, setText] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [chat.length])

  function send() {
    const prompt = text.trim()
    if (!prompt || busy) return
    onAsk(prompt)
    setText('')
  }

  function fill(prompt: string) {
    setText(prompt)
    box.current?.focus()
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">Ask AI</h3>
            {connected ? (
              <Badge tone="success" title={`Answers come from ${model}`}>
                Claude
              </Badge>
            ) : (
              <Badge
                tone="warning"
                title="No AI key is set on the server yet, so a stand-in answers: it picks features out of your sentence and adds the usual parts of a few common kinds. Setting ANTHROPIC_API_KEY switches this to Claude."
              >
                stand-in
              </Badge>
            )}
          </div>
          {chat.length > 0 && (
            <button onClick={onClear} className="text-2xs text-faint hover:text-ink">
              Clear the conversation
            </button>
          )}
        </div>

        {chat.length > 0 && (
          <div ref={log} className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border bg-raised/50 p-2.5">
            {chat.map((turn, index) => (
              <div key={index} className={cn('flex', turn.from === 'you' ? 'justify-end' : 'justify-start')}>
                <p
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm',
                    turn.from === 'you' ? 'bg-accent text-white' : 'border border-border bg-surface text-ink',
                  )}
                >
                  {turn.text}
                </p>
              </div>
            ))}
            {busy && <p className="text-xs text-faint">Drafting…</p>}
          </div>
        )}

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          <textarea
            ref={box}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            rows={2}
            placeholder={
              hasItems
                ? 'Say what to change: "add Reviews inside Trails", "Payment needs Cart"…'
                : 'Describe what you want to build and its main parts…'
            }
            className="min-h-[44px] min-w-0 flex-1 resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <Button type="submit" disabled={!text.trim()} loading={busy}>
            <SendHorizontal className="h-3.5 w-3.5" />
            Send
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-faint">
          <span>{hasItems ? 'Try:' : 'For example:'}</span>
          {(hasItems ? FOLLOW_UPS : ASK_EXAMPLES).map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => fill(example)}
              className="rounded-full border border-border px-2 py-0.5 text-muted hover:border-accent hover:text-accent"
            >
              {example}
            </button>
          ))}
          <span className="ml-auto">Enter to send · Shift+Enter for a new line · Undo takes an answer back</span>
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * The selected feature's dependencies: what it needs, what needs it, and a
 * way to add one. The AI's suggestions are confirmed or dismissed here one at
 * a time.
 */
function NeedsPanel({
  items,
  selected,
  loops,
  onSelect,
  onChange,
}: {
  items: DraftFeature[]
  selected: string
  loops: Set<string>
  onSelect: (key: string) => void
  onChange: (next: DraftFeature[]) => void
}) {
  const item = items.find((row) => row.key === selected)
  if (!item) return null

  const titles = new Map(items.map((row) => [row.key, row.title || 'Untitled']))
  const needs = item.needs ?? []
  const waiting = neededBy(items, item.key)
  const options = items.filter(
    (row) => row.title.trim() && canNeed(items, item.key, row.key) && !needs.some((need) => need.key === row.key),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="truncate">{item.title || 'Untitled'}</span>
          <span className="ml-2 font-normal text-faint">dependencies</span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted">Needs: cannot start until these are finished</h4>
          {needs.length === 0 ? (
            <p className="text-xs text-faint">Nothing.</p>
          ) : (
            <ul className="space-y-1">
              {needs.map((need) => (
                <li
                  key={need.key}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                    need.suggested ? 'border-dashed border-accent/60 bg-accent-soft/40' : 'border-border',
                  )}
                >
                  <button onClick={() => onSelect(need.key)} className="min-w-0 flex-1 truncate text-left text-ink hover:underline">
                    {titles.get(need.key) ?? '?'}
                  </button>
                  {need.suggested && <span className="text-2xs text-accent">suggested</span>}
                  {loops.has(`${item.key}>${need.key}`) && (
                    <Badge tone="danger" title="These wait on each other, so neither can start">
                      loop
                    </Badge>
                  )}
                  {need.suggested && (
                    <RowAction label="Confirm" onClick={() => onChange(addNeed(items, item.key, need.key))}>
                      <Check className="h-3.5 w-3.5" />
                    </RowAction>
                  )}
                  <RowAction
                    label={need.suggested ? 'Dismiss' : 'Remove'}
                    onClick={() => onChange(removeNeed(items, item.key, need.key))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </RowAction>
                </li>
              ))}
            </ul>
          )}
          {options.length > 0 && (
            <select
              value=""
              onChange={(event) => {
                if (event.target.value) onChange(addNeed(items, item.key, event.target.value))
              }}
              aria-label="Add a dependency"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="">Add a dependency…</option>
              {options.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.title}
                </option>
              ))}
            </select>
          )}
        </section>

        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted">Needed by</h4>
          {waiting.length === 0 ? (
            <p className="text-xs text-faint">Nothing waits on it.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {waiting.map((row) => {
                const suggested = row.needs?.find((need) => need.key === item.key)?.suggested
                return (
                  <button
                    key={row.key}
                    onClick={() => onSelect(row.key)}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-xs hover:border-accent',
                      suggested ? 'border-dashed border-accent/60 text-accent' : 'border-border text-ink',
                    )}
                  >
                    {row.title || 'Untitled'}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </CardBody>
    </Card>
  )
}

// ---------- getting a list in ----------

/**
 * Copies the instructions that make any outside chat AI answer in the format
 * Paste and Open file read, for when Ask AI has no key to use.
 */
function CopyInstructionsButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(AI_INSTRUCTIONS)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2000)
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={copy}
      title="Copy instructions to paste after your prompt in ChatGPT, Grok or any chat AI. Its answer opens here with Paste or Open file."
    >
      {state === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : 'Copy AI instructions'}
    </Button>
  )
}

function FileButton({ onFile }: { onFile: (file: File | undefined) => void }) {
  return (
    <label className="inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-raised">
      <FileUp className="h-3.5 w-3.5" />
      Open file
      <input
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </label>
  )
}

/** A compact project chooser for the header: picking one opens it in place of the list. */
function OpenProjectPicker({ busy, onOpen }: { busy: boolean; onOpen: (projectId: number) => void }) {
  const projects = useProjects({ per_page: 200 })
  const list = projects.data?.items ?? []

  return (
    <label
      className={cn(
        'relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-raised',
        busy && 'opacity-60',
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
      Open project
      <select
        value=""
        disabled={busy || list.length === 0}
        onChange={(event) => {
          if (event.target.value) onOpen(Number(event.target.value))
        }}
        aria-label="Open a project in the playground"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Open a project…</option>
        {list.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** "Saved", "Saving…" or "Not saved — retry", next to the title. */
function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'failed') {
    return (
      <button onClick={onRetry} className="inline-flex items-center gap-1 text-2xs text-danger hover:underline">
        <CloudOff className="h-3 w-3" />
        Not saved · retry
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-faint" aria-live="polite">
      {state === 'saved' ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
      {state === 'saved' ? 'Saved' : 'Saving…'}
    </span>
  )
}

/**
 * What an empty playground offers besides the AI above it: bring in a project
 * that already exists, or start a list by hand.
 */
function EmptyState({
  busy,
  onOpenProject,
  onExample,
  onAdd,
}: {
  busy: boolean
  onOpenProject: (projectId: number) => void
  onExample: () => void
  onAdd: (title: string) => void
}) {
  const [title, setTitle] = useState('')
  const projects = useProjects({ per_page: 200 })
  const list = projects.data?.items ?? []

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">Open a project</h3>
          </div>
          <p className="text-sm text-muted">
            Bring a project's features, dependencies and releases in to reshape and re-plan them. Importing
            back renames and moves the same features.
          </p>
          {projects.isPending ? (
            <div className="space-y-1.5">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : list.length === 0 ? (
            <p className="text-xs text-faint">No projects yet. Draft one with the AI above and import it.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {list.map((project) => (
                <li key={project.id}>
                  <button
                    disabled={busy}
                    onClick={() => onOpenProject(project.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50"
                  >
                    <span className="truncate text-ink">{project.name}</span>
                    {project.stats && (
                      <span className="shrink-0 text-2xs text-faint">{plural(project.stats.feature_count, 'feature')}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <Shapes className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">Or start a list</h3>
          </div>
          <p className="text-sm text-muted">
            Type a feature, paste a list from anywhere (one per line, or bullets indented to nest, with{' '}
            <code className="font-mono text-xs">needs:</code> for dependencies), open a file, or load an
            example to see how it works.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim()) onAdd(title.trim())
              setTitle('')
            }}
          >
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="First feature…"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <Button type="submit" variant="secondary" disabled={!title.trim()}>
              Add
            </Button>
          </form>
          <Button variant="ghost" size="sm" onClick={onExample}>
            Load an example
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}

function PasteDialog({
  hasItems,
  onClose,
  onSubmit,
}: {
  hasItems: boolean
  onClose: () => void
  onSubmit: (text: string, mode: 'replace' | 'append') => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-title"
        className="w-full max-w-lg animate-fade-in rounded-lg border border-border bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="paste-title" className="text-sm font-semibold text-ink">
            Paste a list
          </h2>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted">
            One feature per line, or markdown bullets — indent a bullet to put it inside the one above.
          </p>
          <textarea
            ref={ref}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={'- Accounts\n  - Sign in\n- Checkout'}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {hasItems && (
              <Button variant="secondary" disabled={!text.trim()} onClick={() => onSubmit(text, 'append')}>
                Add to the list
              </Button>
            )}
            <Button disabled={!text.trim()} onClick={() => onSubmit(text, 'replace')}>
              {hasItems ? 'Replace the list' : 'Use this list'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
