import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Info,
  Maximize2,
  Minimize2,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCreateDependency,
  useDeleteDependency,
  useDependencyGraph,
  useProject,
} from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { NewFeatureDialog } from '@/pages/NewFeatureDialog'
import { cn, plural } from '@/lib/utils'
import {
  buildTree,
  chainFrom,
  liftEdges,
  routeEdges,
  tierise,
  visibleIds,
  type LiftedEdge,
  type Rect,
  type RoutedEdge,
  type Tree,
} from '@/lib/dependency-layout'
import { MARKDOWN_EXAMPLE, parseDependencyMarkdown } from '@/lib/dependency-markdown'
import { STATUS_LABEL, type FeatureStatus, type GraphNode } from '@/lib/types'
import '@/styles/dependency-canvas.css'

/**
 * The dependency canvas.
 *
 * The map answers two different questions at once and keeps them visually
 * apart. A boundary means *part of*: these features make up that one. An
 * arrow means *requires*: this cannot start until that is finished. Reading
 * down the page is reading forward in time.
 *
 * Opening a branch grows it in place and pushes its siblings aside rather
 * than covering the map with a panel. That matters because the dependencies
 * worth seeing are usually the ones that cross a boundary — something inside
 * one branch waiting on something inside another — and a panel cannot draw
 * them at all.
 *
 * The browser lays the cards out; the arrows are measured off the result. See
 * lib/dependency-layout.ts.
 */

const DOT: Record<FeatureStatus, string> = {
  todo: 'hsl(var(--dc-todo))',
  in_progress: 'hsl(var(--dc-doing))',
  done: 'hsl(var(--dc-done))',
}

const BLOCKED_DOT = 'hsl(var(--dc-blocked))'

// One sketch per project. A single shared key made every project's canvas show
// whatever was last sketched anywhere, in place of the project's own features.
const sketchKey = (projectId: number) => `featureplus.dependency-sketch.${projectId}`

const SKETCH_PLACEHOLDER = [
  '- Platform',
  '  - Accounts [done]',
  '  - Data Store > needs: Accounts',
].join('\n')

export function DependencyCanvas({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const graph = useDependencyGraph(projectId)
  const createDependency = useCreateDependency(projectId)
  const deleteDependency = useDeleteDependency(projectId)

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [blockedMode, setBlockedMode] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [connectedOnly, setConnectedOnly] = useState(false)
  const [hideDone, setHideDone] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState<RoutedEdge | null>(null)
  const [addChildTo, setAddChildTo] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')

  // A map typed by hand instead of read from the project. It is kept in the
  // browser so a sketch survives a reload, which is the whole point of having
  // it: trying shapes without creating a project to hold them.
  const [sketch, setSketch] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(sketchKey(projectId))
    } catch {
      return null
    }
  })
  const [sketchOpen, setSketchOpen] = useState(false)

  // A big map does not fit the page's content column. Filling the window is
  // its own mode rather than the browser's fullscreen, so the app's own
  // keyboard and scrolling keep behaving normally.
  const [filling, setFilling] = useState(false)

  // A dependency being drawn: the blocker it started from, and where the
  // pointer is now, in canvas coordinates.
  const [connectFrom, setConnectFrom] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  const parsed = useMemo(
    () => (sketch === null ? null : parseDependencyMarkdown(sketch)),
    [sketch],
  )

  // Everything below this line works the same either way: the markdown is
  // parsed into the shape the API returns, so there is one renderer, not two.
  const preview = parsed !== null
  const source = parsed?.graph ?? graph.data

  const allNodes = useMemo(() => source?.nodes ?? [], [source])
  const allEdges = useMemo(() => source?.edges ?? [], [source])
  const cycles = source?.cycles ?? []

  // "Connected only" drops features with no dependency at either end. A parent
  // is kept whenever anything inside it is connected, otherwise its children
  // would lose the boundary they belong to.
  const nodes = useMemo(() => {
    if (!connectedOnly) return allNodes

    const connected = new Set<number>()
    for (const edge of allEdges) {
      connected.add(edge.parent_id)
      connected.add(edge.child_id)
    }

    const parentOf = new Map<number, number | null>()
    for (const node of allNodes) parentOf.set(node.id, node.parent_id)

    const keep = new Set<number>()
    for (const id of connected) {
      let current: number | null | undefined = id
      while (current != null && !keep.has(current)) {
        keep.add(current)
        current = parentOf.get(current)
      }
    }

    return allNodes.filter((node) => keep.has(node.id))
  }, [allNodes, allEdges, connectedOnly])

  const tree = useMemo(() => buildTree(nodes), [nodes])
  const visible = useMemo(() => visibleIds(tree, expanded), [tree, expanded])
  const lifted = useMemo(() => liftEdges(tree, allEdges, visible), [tree, allEdges, visible])

  // Whether a feature takes part in any dependency at all. Having none is
  // what "independent" means on the canvas; having none *among its siblings*
  // only decides which row it sits in.
  const connected = useMemo(() => {
    const out = new Set<number>()
    for (const edge of allEdges) {
      out.add(edge.parent_id)
      out.add(edge.child_id)
    }
    return out
  }, [allEdges])

  // What each feature waits on and what waits on it, by title, for the panel.
  const relations = useMemo(() => {
    const blockedBy = new Map<number, string[]>()
    const blocks = new Map<number, string[]>()
    for (const edge of allEdges) {
      const parent = tree.byId.get(edge.parent_id)
      const child = tree.byId.get(edge.child_id)
      if (!parent || !child) continue
      blockedBy.set(child.id, [...(blockedBy.get(child.id) ?? []), parent.title])
      blocks.set(parent.id, [...(blocks.get(parent.id) ?? []), child.title])
    }
    return { blockedBy, blocks }
  }, [allEdges, tree])

  // A feature is blocked when it is not finished and something it waits on is
  // not finished either. That is the only blocking this map can see: a hold
  // that comes from outside the project has nothing here to show it.
  const blocked = useMemo(() => {
    const out = new Map<number, string[]>()
    for (const edge of allEdges) {
      const parent = tree.byId.get(edge.parent_id)
      const child = tree.byId.get(edge.child_id)
      if (!parent || !child) continue
      if (child.status === 'done' || parent.status === 'done') continue
      out.set(child.id, [...(out.get(child.id) ?? []), parent.title])
    }
    return out
  }, [allEdges, tree])

  // A branch counts as blocked when anything inside it is, so closing it does
  // not hide the problem.
  const blockedWithin = useCallback(
    (id: number): boolean => {
      if (blocked.has(id)) return true
      return (tree.childrenOf.get(id) ?? []).some(blockedWithin)
    },
    [blocked, tree],
  )

  // --- Measurement --------------------------------------------------------

  const [pos, setPos] = useState<Map<number, Rect>>(new Map())
  const [canvasWidth, setCanvasWidth] = useState(1200)
  const posKey = useRef('')

  const measure = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const origin = canvas.getBoundingClientRect()
    const next = new Map<number, Rect>()
    for (const el of canvas.querySelectorAll<HTMLElement>('[data-node]')) {
      const box = el.getBoundingClientRect()
      next.set(Number(el.dataset.node), {
        x: Math.round(box.left - origin.left),
        y: Math.round(box.top - origin.top + canvas.scrollTop),
        w: Math.round(box.width),
        h: Math.round(box.height),
      })
    }

    const key = JSON.stringify([...next])
    if (key === posKey.current) return
    posKey.current = key
    setPos(next)
    setCanvasWidth(canvas.clientWidth)
  }, [])

  // Measure after every paint: the layout moves whenever a branch opens, the
  // window resizes, or a web font finally loads.
  useLayoutEffect(measure)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    for (const el of canvas.querySelectorAll('[data-node]')) observer.observe(el)

    if (document.fonts?.ready) void document.fonts.ready.then(measure)
    return () => observer.disconnect()
  }, [measure, visible, hideDone])

  const routed = useMemo(
    () => routeEdges(tree, lifted, pos, canvasWidth),
    [tree, lifted, pos, canvasWidth],
  )

  // Picking a feature narrows the map to its chain. Without this a map of a
  // hundred features is a wall of arrows: the picture can show every path at
  // once, but it cannot show you *one*.
  const focus = useMemo(
    () => (selected === null ? null : chainFrom(tree, selected, lifted)),
    [selected, tree, lifted],
  )

  // --- Search -------------------------------------------------------------

  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!needle) return { onCanvas: [] as number[], nested: [] as number[] }

    const onCanvas: number[] = []
    const nested: number[] = []
    for (const node of nodes) {
      if (!node.title.toLowerCase().includes(needle)) continue
      if (visible.has(node.id)) onCanvas.push(node.id)
      else nested.push(node.id)
    }
    return { onCanvas, nested }
  }, [needle, nodes, visible])

  // --- Actions ------------------------------------------------------------

  const toggle = useCallback((id: number) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setHovered(null)
  }, [])

  const setDepth = useCallback(
    (level: number) => {
      const next = new Set<number>()
      for (const node of nodes) {
        const nodeLevel = tree.levelOf.get(node.id) ?? 0
        if (nodeLevel < level && (tree.childrenOf.get(node.id)?.length ?? 0) > 0) {
          next.add(node.id)
        }
      }
      setExpanded(next)
      setSelected(null)
      setBlockedMode(false)
      setQuery('')
      setHovered(null)
    },
    [nodes, tree],
  )

  /** Open every branch on the way to a feature, then select it. */
  const revealNested = useCallback(
    (id: number) => {
      setExpanded((current) => {
        const next = new Set(current)
        let parent = tree.parentOf.get(id)
        while (parent !== undefined) {
          next.add(parent)
          parent = tree.parentOf.get(parent)
        }
        return next
      })
      setQuery('')
      setSelected(id)
    },
    [tree],
  )

  const connect = useCallback(
    async (from: number, to: number) => {
      setMessage('')
      setWarning('')
      try {
        const created = await createDependency.mutateAsync({ parent_id: from, child_id: to })
        if (created.creates_cycle) {
          setWarning('That dependency closes a loop. The features now block each other.')
        }
      } catch (error) {
        setMessage(error instanceof ApiError ? error.message : 'Could not add that dependency')
      }
    },
    [createDependency],
  )

  // Drawing a dependency. The listeners go on at pointerdown rather than from
  // an effect: a quick drag can be over before React has re-rendered, and an
  // effect would attach them too late to see it. The ref carries the live
  // values into handlers that outlive the render they were made in.
  const dragRef = useRef<{ from: number; target: number | null } | null>(null)

  const beginConnect = useCallback(
    (from: number, event: React.PointerEvent) => {
      event.stopPropagation()
      event.preventDefault()

      dragRef.current = { from, target: null }
      setConnectFrom(from)
      setDropTarget(null)

      const onMove = (moved: PointerEvent) => {
        const canvas = canvasRef.current
        const drag = dragRef.current
        if (!canvas || !drag) return

        const origin = canvas.getBoundingClientRect()
        setPointer({
          x: moved.clientX - origin.left,
          y: moved.clientY - origin.top + canvas.scrollTop,
        })

        const card = document
          .elementFromPoint(moved.clientX, moved.clientY)
          ?.closest<HTMLElement>('[data-node]')
        const id = card ? Number(card.dataset.node) : null
        const target = id !== null && id !== drag.from ? id : null
        drag.target = target
        setDropTarget(target)
      }

      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('keydown', onKey)
        dragRef.current = null
        setConnectFrom(null)
        setPointer(null)
        setDropTarget(null)
      }

      const onUp = (released: PointerEvent) => {
        const drag = dragRef.current
        stop()
        if (!drag) return

        // A quick flick can release without a single move in between, so the
        // drop is resolved from where the pointer actually came up rather than
        // from the last move that happened to be seen.
        const card = document
          .elementFromPoint(released.clientX, released.clientY)
          ?.closest<HTMLElement>('[data-node]')
        const under = card ? Number(card.dataset.node) : null
        const target = drag.target ?? (under !== null && under !== drag.from ? under : null)

        if (target !== null) void connect(drag.from, target)
      }

      const onKey = (pressed: KeyboardEvent) => {
        if (pressed.key === 'Escape') stop()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('keydown', onKey)
    },
    [connect],
  )

  // "Add dependency" in the panel is the same thing without a drag: the next
  // card picked becomes the one that waits.
  const [armedFrom, setArmedFrom] = useState<number | null>(null)

  async function removeSelectedEdge() {
    if (!selectedEdge) return
    setMessage('')
    try {
      for (const id of selectedEdge.ids) await deleteDependency.mutateAsync(id)
      setSelectedEdge(null)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Could not remove that dependency')
    }
  }

  // Switching between the project and a sketch starts the view over. The two
  // number their features separately, so anything remembered by id — what was
  // open, what was picked — means something else on the other side.
  useEffect(() => {
    setExpanded(new Set())
    setSelected(null)
    setHovered(null)
    setSelectedEdge(null)
    setArmedFrom(null)
    setBlockedMode(false)
    setQuery('')
  }, [preview])

  useEffect(() => {
    if (!filling) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilling(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filling])

  useEffect(() => {
    try {
      if (sketch === null) window.localStorage.removeItem(sketchKey(projectId))
      else window.localStorage.setItem(sketchKey(projectId), sketch)
    } catch {
      // Private windows and blocked site data; the sketch just will not
      // survive a reload, which is not worth failing the page over.
    }
  }, [sketch, projectId])

  const reset = () => {
    setExpanded(new Set())
    setSelected(null)
    setHovered(null)
    setQuery('')
    setBlockedMode(false)
    setIndexOpen(false)
    setConnectedOnly(false)
    setHideDone(false)
    setSelectedEdge(null)
    setArmedFrom(null)
  }

  // --- Render -------------------------------------------------------------

  if (graph.isError && !preview) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {graph.error instanceof ApiError ? graph.error.message : 'Could not load the graph'}
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => graph.refetch()}>
            Try again
          </Button>
        </CardBody>
      </Card>
    )
  }

  const dimmed = needle.length > 0 || blockedMode
  const blockedIds = [...blocked.keys()].filter((id) => pos.has(id) && !expanded.has(id))
  const selectedNode = selected !== null ? tree.byId.get(selected) : undefined
  const hoveredNode = hovered !== null && selected === null ? tree.byId.get(hovered) : undefined

  const context = {
    tree,
    expanded,
    selected,
    hideDone,
    dropTarget,
    connecting: connectFrom !== null,
    blocked,
    blockedWithin,
    lifted,
    connected,
    focus,
    onPick: (id: number) => {
      if (armedFrom !== null) {
        const from = armedFrom
        setArmedFrom(null)
        if (from !== id) void connect(from, id)
        return
      }
      setSelected(id)
      setIndexOpen(false)
      setHovered(null)
      setSelectedEdge(null)
    },
    onHover: setHovered,
    onToggle: toggle,
    readOnly: preview,
    onStartConnect: beginConnect,
  }

  return (
    <div
      className={cn(
        'dc',
        filling ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-bg p-3' : 'space-y-3',
      )}
    >
      {!filling && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => navigate({ name: 'project', projectId })}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {project.data?.name ?? 'Project'}
          </Button>
        </div>
      )}

      {cycles.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-xs">
            <p className="font-medium text-ink">
              {plural(cycles.length, 'circular dependency', 'circular dependencies')} found
            </p>
            <p className="mt-0.5 text-muted">
              Features in a loop each wait on the other, so none of them can start. The arrows
              involved are drawn in amber.
            </p>
          </div>
        </div>
      )}

      {message && <Banner tone="danger" onDismiss={() => setMessage('')}>{message}</Banner>}
      {warning && <Banner tone="warning" onDismiss={() => setWarning('')}>{warning}</Banner>}

      <div
        className={cn(
          'overflow-hidden rounded-lg border border-border',
          filling && 'flex min-h-0 flex-1 flex-col',
        )}
      >
        <Header
          projectName={project.data?.name ?? 'Project'}
          query={query}
          onQuery={setQuery}
          nestedMatches={matches.nested.map((id) => ({
            id,
            title: tree.byId.get(id)?.title ?? '',
            where: tree.byId.get(tree.parentOf.get(id) ?? -1)?.title ?? '',
          }))}
          onOpenNested={revealNested}
          maxLevel={tree.maxLevel}
          level={currentLevel(tree, expanded)}
          onDepth={setDepth}
          blockedMode={blockedMode}
          blockedCount={blocked.size}
          onToggleBlocked={() => {
            setBlockedMode((v) => !v)
            setQuery('')
            setSelected(null)
            setIndexOpen(false)
          }}
          indexOpen={indexOpen}
          onToggleIndex={() => {
            setIndexOpen((v) => !v)
            setSelected(null)
          }}
          filling={filling}
          onToggleFilling={() => setFilling((v) => !v)}
          preview={preview}
          sketchOpen={sketchOpen}
          onToggleSketch={() => {
            setSketchOpen((v) => !v)
            setIndexOpen(false)
            setSelected(null)
          }}
        />

        <div className={cn('relative', filling && 'min-h-0 flex-1')}>
        <div
          ref={canvasRef}
          className={cn(
            'dc-canvas overflow-auto',
            filling ? 'h-full' : 'h-[calc(100vh-255px)] min-h-[460px]',
          )}
          onClick={() => {
            setSelected(null)
            setSelectedEdge(null)
          }}
        >
          {graph.isLoading && !preview ? (
            <div className="grid h-full place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : tree.roots.length === 0 ? (
            <EmptyCanvas
              preview={preview}
              hasFeatures={allNodes.length > 0}
              filtered={connectedOnly}
              onClearFilters={() => setConnectedOnly(false)}
            />
          ) : (
            <div className="relative flex min-h-full flex-col gap-20 px-6 pb-28 pt-[74px]">
              <Legend />

              <EdgeLayer
                edges={routed}
                focus={focus?.keys ?? null}
                selectedId={selectedEdge?.ids[0] ?? null}
                onPick={(edge) => {
                  setSelectedEdge(edge)
                  setSelected(null)
                }}
                drag={
                  connectFrom !== null && pointer && pos.has(connectFrom)
                    ? { from: pos.get(connectFrom)!, to: pointer }
                    : null
                }
              />

              <Container
                container={null}
                ids={tree.roots}
                showTiers
                ctx={context}
              />

              {dimmed && <div className="dc-scrim absolute inset-0 z-[8]" />}

              {needle.length > 0 &&
                matches.onCanvas
                  .filter((id) => !expanded.has(id))
                  .map((id) => (
                  <Spotlight
                    key={id}
                    rect={pos.get(id)}
                    title={tree.byId.get(id)?.title ?? ''}
                    chip={`L${tree.levelOf.get(id) ?? 0}`}
                  />
                  ))}

              {blockedMode &&
                blockedIds.map((id) => (
                  <Spotlight
                    key={id}
                    rect={pos.get(id)}
                    title={tree.byId.get(id)?.title ?? ''}
                    chip={`WAITING ON ${(blocked.get(id) ?? []).length}`}
                    tone="blocked"
                  />
                ))}

              {hoveredNode && (
                <HoverCard node={hoveredNode} rect={pos.get(hoveredNode.id)} tree={tree} />
              )}
            </div>
          )}
        </div>

          {blockedMode && (preview || !graph.isLoading) && (
            <BlockedRollup
              rows={[...blocked.entries()].map(([id, waitingOn]) => ({
                id,
                title: tree.byId.get(id)?.title ?? '',
                where: whereIs(tree, id),
                offCanvas: !pos.has(id),
                waitingOn,
              }))}
              onPick={(id) => {
                setBlockedMode(false)
                revealNested(id)
              }}
            />
          )}

          {selectedNode && (
            <DetailPanel
              node={selectedNode}
              tree={tree}
              readOnly={preview}
              blockedBy={relations.blockedBy.get(selectedNode.id) ?? []}
              blocks={relations.blocks.get(selectedNode.id) ?? []}
              onClose={() => setSelected(null)}
              onAddDependency={() => {
                setArmedFrom(selectedNode.id)
                setSelected(null)
              }}
              onAddChild={() => setAddChildTo(selectedNode.id)}
              onOpen={() =>
                navigate({ name: 'feature', projectId, featureId: selectedNode.id })
              }
            />
          )}

          {indexOpen && <OptionsIndex onClose={() => setIndexOpen(false)} />}

          {sketchOpen && (
            <SketchPanel
              value={sketch}
              problems={parsed?.problems ?? []}
              counts={{ features: allNodes.length, dependencies: allEdges.length }}
              onChange={setSketch}
              onClose={() => setSketchOpen(false)}
            />
          )}

          {selectedEdge && (
            <EdgeActions
              edge={selectedEdge}
              tree={tree}
              readOnly={preview}
              busy={deleteDependency.isPending}
              onRemove={removeSelectedEdge}
              onDismiss={() => setSelectedEdge(null)}
            />
          )}

          {tree.roots.length > 0 && (preview || !graph.isLoading) && (
            <BottomBar
              connectedOnly={connectedOnly}
              hideDone={hideDone}
              onConnectedOnly={setConnectedOnly}
              onToggleHideDone={() => setHideDone((v) => !v)}
              onReset={reset}
            />
          )}
        </div>

        <div className="dc-chrome flex items-center gap-2.5 border-t px-5 py-3 text-xs text-muted">
          <Info className="h-3.5 w-3.5 shrink-0" />
          {preview
            ? 'Previewing a map written by hand. Indentation nests a feature inside another; "needs:" adds a dependency. Nothing here is saved to the project.'
            : connectFrom !== null
            ? 'Drop on the feature that has to wait. Escape cancels.'
            : armedFrom !== null
              ? `Now click the feature that waits on ${tree.byId.get(armedFrom)?.title}.`
              : 'Drag from the dot under one card onto another to add a dependency. A card sits below whatever must be finished first. Arrows mean dependency; boundaries mean hierarchy.'}
        </div>
      </div>

      {addChildTo !== null && (
        <NewFeatureDialog
          projectId={projectId}
          parentFeatureId={addChildTo}
          parentTitle={tree.byId.get(addChildTo)?.title}
          onClose={() => {
            setExpanded((current) => new Set(current).add(addChildTo))
            setAddChildTo(null)
          }}
        />
      )}
    </div>
  )
}

/** The branch a feature lives in, for rows that are not on the canvas. */
function whereIs(tree: Tree, id: number) {
  const parent = tree.parentOf.get(id)
  return parent === undefined ? '' : (tree.byId.get(parent)?.title ?? '')
}

/** The deepest level currently open, which is what the DEPTH pill sits on. */
function currentLevel(tree: Tree, expanded: Set<number>) {
  let level = 0
  for (const id of expanded) {
    const nodeLevel = (tree.levelOf.get(id) ?? 0) + 1
    if (nodeLevel > level) level = nodeLevel
  }
  return level
}

// --- The tree ---------------------------------------------------------------

interface Ctx {
  tree: Tree
  expanded: Set<number>
  selected: number | null
  hideDone: boolean
  dropTarget: number | null
  connecting: boolean
  blocked: Map<number, string[]>
  blockedWithin: (id: number) => boolean
  lifted: LiftedEdge[]
  connected: Set<number>
  /** The picked feature's chain, or null when nothing is picked. */
  focus: { nodes: Set<number>; keys: Set<string> } | null
  /** A previewed map has nowhere to write to, so it cannot be edited. */
  readOnly: boolean
  onPick: (id: number) => void
  onHover: (id: number | null) => void
  onToggle: (id: number) => void
  onStartConnect: (id: number, event: React.PointerEvent) => void
}

/**
 * One container's children, in rows.
 *
 * Only the outermost container labels its rows. Inside a branch the tiers are
 * local — first thing in the branch, then what waits on it — and numbering
 * them again would read as though they lined up with the outer ones.
 */
function Container({
  container,
  ids,
  showTiers,
  ctx,
}: {
  container: number | null
  ids: number[]
  showTiers?: boolean
  ctx: Ctx
}) {
  const { rows, independent } = useMemo(
    () => tierise(ctx.tree, container, ids, ctx.lifted),
    [ctx.tree, ctx.lifted, container, ids],
  )

  // A feature with no dependency among its siblings still belongs in the
  // rows if it depends on something elsewhere — only one with no dependency
  // at all is independent, and only those go in the corral.
  const free = independent.filter((id) => !ctx.connected.has(id))
  const loose = independent.filter((id) => ctx.connected.has(id))

  const placed = loose.length > 0 ? [[...loose, ...(rows[0] ?? [])], ...rows.slice(1)] : rows

  return (
    <>
      {placed.map((row, tier) => (
        <div key={tier} className="flex w-full items-start">
          {showTiers && (
            <div className="dc-eyebrow w-[84px] flex-none pt-3.5 opacity-70">TIER {tier}</div>
          )}
          <div className="flex flex-1 flex-wrap items-start justify-center gap-6">
            {row.map((id) => (
              <NodeOrBranch key={id} id={id} ctx={ctx} />
            ))}
          </div>
        </div>
      ))}

      {free.length > 0 &&
        (showTiers ? (
          <div className="flex w-full items-start">
            <div className="w-[84px] flex-none" />
            <div className="dc-corral">
              <span className="dc-corral-tag dc-eyebrow">INDEPENDENT · NO DEPENDENCIES</span>
              {free.map((id) => (
                <NodeOrBranch key={id} id={id} independent ctx={ctx} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-center gap-5">
            {free.map((id) => (
              <NodeOrBranch key={id} id={id} independent ctx={ctx} />
            ))}
          </div>
        ))}
    </>
  )
}

function NodeOrBranch({
  id,
  independent,
  ctx,
}: {
  id: number
  independent?: boolean
  ctx: Ctx
}) {
  const children = ctx.tree.childrenOf.get(id) ?? []
  const open = ctx.expanded.has(id) && children.length > 0
  return open ? (
    <Branch id={id} ctx={ctx} />
  ) : (
    <NodeCard id={id} independent={independent} ctx={ctx} />
  )
}

/** An open branch: the boundary, its label, and the features inside it. */
function Branch({ id, ctx }: { id: number; ctx: Ctx }) {
  const node = ctx.tree.byId.get(id)!
  const children = ctx.tree.childrenOf.get(id) ?? []

  return (
    <div
      data-node={id}
      className={cn('dc-branch', ctx.focus && !ctx.focus.nodes.has(id) && 'dc-dim')}
    >
      <div className="dc-branch-tag">
        <span className="dc-dot !h-[7px] !w-[7px]" style={{ background: statusColour(node, ctx) }} />
        <button
          onClick={(event) => {
            event.stopPropagation()
            ctx.onPick(id)
          }}
          className="text-[11.5px] font-semibold"
          style={{ color: 'hsl(var(--dc-violet-2))' }}
        >
          {node.title}
        </button>
        <span
          className="dc-mono text-[8.5px] font-medium tracking-[0.14em]"
          style={{ color: 'hsl(var(--dc-violet-2) / 0.75)' }}
        >
          PART OF
        </span>
        <button
          aria-label={`Collapse ${node.title}`}
          onClick={(event) => {
            event.stopPropagation()
            ctx.onToggle(id)
          }}
          className="dc-expand !h-4 !w-4 !bg-transparent !text-[11px]"
        >
          −
        </button>
      </div>

      <div className="flex flex-col items-center gap-12">
        <Container container={id} ids={children} ctx={ctx} />
      </div>
    </div>
  )
}

function NodeCard({
  id,
  independent,
  ctx,
}: {
  id: number
  independent?: boolean
  ctx: Ctx
}) {
  const node = ctx.tree.byId.get(id)!
  const children = ctx.tree.childrenOf.get(id) ?? []
  const level = ctx.tree.levelOf.get(id) ?? 0
  const isRoot = level === 0 && ctx.tree.parentOf.get(id) === undefined

  // A card that nothing in its container waits on is the anchor of that
  // container, and is drawn to read as the start of the chain.
  const isAnchor = !isRoot && !independent && ctx.lifted.every((e) => e.to !== id)

  if (ctx.hideDone && node.status === 'done') {
    return (
      <div
        data-node={id}
        className="dc-eyebrow flex items-center justify-center rounded-xl border border-dashed px-4 py-3"
        style={{ borderColor: 'hsl(var(--dc-line) / 0.16)' }}
      >
        DONE · HIDDEN
      </div>
    )
  }

  const blockedHere = ctx.blocked.has(id) || (children.length > 0 && ctx.blockedWithin(id))

  return (
    <div
      data-node={id}
      onClick={(event) => {
        event.stopPropagation()
        ctx.onPick(id)
      }}
      onMouseEnter={() => ctx.onHover(id)}
      onMouseLeave={() => ctx.onHover(null)}
      className={cn(
        independent ? 'dc-card-indep' : isRoot ? 'dc-card-root' : isAnchor ? 'dc-card-anchor' : 'dc-card',
        ctx.focus && !ctx.focus.nodes.has(id) && 'dc-dim',
        ctx.selected === id && 'dc-sel',
        ctx.dropTarget === id && 'dc-drop',
        blockedHere && !ctx.selected && 'dc-cycle',
        ctx.connecting && 'dc-connecting',
      )}
    >
      <span
        className="dc-dot"
        style={{ background: blockedHere ? BLOCKED_DOT : statusColour(node, ctx) }}
      />
      <span className="dc-name" title={node.title}>
        {node.title}
      </span>

      {isRoot && !independent && <span className="dc-chip dc-chip-root">ROOT</span>}
      {independent && <span className="dc-chip">INDEP</span>}

      {children.length > 0 && (
        <>
          <button
            aria-label={`Expand ${node.title}`}
            onClick={(event) => {
              event.stopPropagation()
              ctx.onToggle(id)
            }}
            className="dc-expand"
          >
            +
          </button>
          <span
            className="dc-mono text-[9px] font-medium"
            style={{ color: 'hsl(var(--dc-faint))' }}
          >
            {children.length}
          </span>
        </>
      )}

      {!ctx.readOnly && (
        <span
          className="dc-handle"
          title="Drag onto the feature that waits on this one"
          onPointerDown={(event) => ctx.onStartConnect(id, event)}
        />
      )}
    </div>
  )
}

function statusColour(node: GraphNode, ctx: Ctx) {
  if (ctx.blocked.has(node.id)) return BLOCKED_DOT
  return DOT[node.status] ?? DOT.todo
}

// --- Arrows -----------------------------------------------------------------

function EdgeLayer({
  edges,
  focus,
  selectedId,
  onPick,
  drag,
}: {
  edges: RoutedEdge[]
  focus: Set<string> | null
  selectedId: number | null
  onPick: (edge: RoutedEdge) => void
  drag: { from: Rect; to: { x: number; y: number } } | null
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full">
      <defs>
        <marker id="dc-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6.4" markerHeight="6.4" orient="auto">
          <path d="M0 1 L9 5 L0 9 z" fill="hsl(var(--dc-violet) / 0.75)" />
        </marker>
        <marker id="dc-arrow-cross" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6.8" markerHeight="6.8" orient="auto">
          <path d="M0 1 L9 5 L0 9 z" fill="hsl(var(--dc-violet-2))" />
        </marker>
        <marker id="dc-arrow-cycle" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6.8" markerHeight="6.8" orient="auto">
          <path d="M0 1 L9 5 L0 9 z" fill="hsl(var(--dc-doing))" />
        </marker>
      </defs>

      {edges.map((edge) => {
        const chosen = selectedId !== null && edge.ids.includes(selectedId)
        const lit = focus === null || focus.has(`${edge.from}>${edge.to}`)
        const stroke = edge.inCycle
          ? 'hsl(var(--dc-doing))'
          : edge.crossing
            ? 'hsl(var(--dc-violet-2))'
            : 'hsl(var(--dc-violet) / 0.42)'
        return (
          <g key={`${edge.from}>${edge.to}`} opacity={lit ? 1 : 0.12}>
            <path
              d={edge.d}
              className="dc-hit"
              onClick={(event) => {
                event.stopPropagation()
                onPick(edge)
              }}
            />
            <path
              d={edge.d}
              fill="none"
              stroke={stroke}
              strokeWidth={chosen ? 2.6 : edge.crossing || edge.inCycle ? 1.7 : 1.4}
              markerEnd={`url(#${edge.inCycle ? 'dc-arrow-cycle' : edge.crossing ? 'dc-arrow-cross' : 'dc-arrow'})`}
            />
          </g>
        )
      })}

      {drag && (
        <path
          d={`M${drag.from.x + drag.from.w / 2} ${drag.from.y + drag.from.h} L${drag.to.x} ${drag.to.y}`}
          fill="none"
          stroke="hsl(var(--dc-violet))"
          strokeWidth={1.8}
          strokeDasharray="5 5"
        />
      )}
    </svg>
  )
}

// --- Chrome -----------------------------------------------------------------

function Header({
  projectName,
  query,
  onQuery,
  nestedMatches,
  onOpenNested,
  maxLevel,
  level,
  onDepth,
  blockedMode,
  blockedCount,
  onToggleBlocked,
  indexOpen,
  onToggleIndex,
  filling,
  onToggleFilling,
  preview,
  sketchOpen,
  onToggleSketch,
}: {
  projectName: string
  query: string
  onQuery: (value: string) => void
  nestedMatches: { id: number; title: string; where: string }[]
  onOpenNested: (id: number) => void
  maxLevel: number
  level: number
  onDepth: (level: number) => void
  blockedMode: boolean
  blockedCount: number
  onToggleBlocked: () => void
  indexOpen: boolean
  onToggleIndex: () => void
  filling: boolean
  onToggleFilling: () => void
  preview: boolean
  sketchOpen: boolean
  onToggleSketch: () => void
}) {
  const levels = Array.from({ length: Math.min(maxLevel, 4) + 1 }, (_, i) => i)

  return (
    <div className="dc-chrome relative z-20 flex min-h-[60px] flex-wrap items-center gap-2 border-b px-5 py-2.5">
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <span style={{ color: 'hsl(var(--dc-muted))' }}>{projectName}</span>
        <span style={{ color: 'hsl(var(--dc-faint))' }}>/</span>
        <span style={{ color: 'hsl(var(--dc-ink))' }}>Dependency map</span>
        {preview && (
          <span
            className="dc-mono ml-1 rounded-[5px] px-1.5 py-1 text-[9px] font-semibold tracking-[0.14em]"
            style={{ background: 'hsl(var(--dc-violet) / 0.16)', color: 'hsl(var(--dc-violet-2))' }}
          >
            MARKDOWN
          </span>
        )}
      </div>

      <div className="flex-1" />

      <div
        className="relative flex w-[224px] items-center gap-2 rounded-[9px] border px-3 py-2"
        style={{
          borderColor: 'hsl(var(--dc-line) / 0.14)',
          background: 'hsl(var(--dc-line) / 0.05)',
        }}
      >
        <Search className="h-3.5 w-3.5 flex-none" style={{ color: 'hsl(var(--dc-faint))' }} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQuery('')
          }}
          placeholder="Search features"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] font-medium outline-none"
          style={{ color: 'hsl(var(--dc-ink))' }}
        />

        {nestedMatches.length > 0 && (
          <div
            className="dc-panel absolute left-0 right-0 top-11 z-30 rounded-[10px] border p-2"
            style={{ borderColor: 'hsl(var(--dc-violet) / 0.35)' }}
          >
            <div className="dc-eyebrow px-1.5 pb-2 pt-0.5">INSIDE COLLAPSED BRANCHES</div>
            {nestedMatches.slice(0, 5).map((match) => (
              <button
                key={match.id}
                onClick={() => onOpenNested(match.id)}
                className="flex w-full items-center justify-between gap-2.5 rounded-[7px] px-2 py-2 text-left hover:bg-[hsl(var(--dc-violet)/0.14)]"
              >
                <span className="text-xs font-medium" style={{ color: 'hsl(var(--dc-ink))' }}>
                  {match.title}
                </span>
                <span
                  className="dc-mono flex-none text-[10px] font-medium"
                  style={{ color: 'hsl(var(--dc-violet-2))' }}
                >
                  in {match.where}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {maxLevel > 0 && (
        <div
          className="flex items-center gap-0.5 rounded-[9px] border p-1"
          style={{
            borderColor: 'hsl(var(--dc-line) / 0.12)',
            background: 'hsl(var(--dc-line) / 0.045)',
          }}
        >
          <span className="dc-eyebrow px-2 pl-1">DEPTH</span>
          {levels.map((value) => (
            <button
              key={value}
              onClick={() => onDepth(value)}
              className={cn(
                'dc-mono w-[34px] rounded-md py-1.5 text-[11px] font-semibold',
                level === value ? 'text-white' : '',
              )}
              style={
                level === value
                  ? { background: 'hsl(var(--dc-violet))', color: '#fff' }
                  : { color: 'hsl(var(--dc-ink))' }
              }
            >
              L{value}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onToggleBlocked}
        disabled={blockedCount === 0}
        className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[12.5px] font-medium disabled:opacity-40"
        style={
          blockedMode
            ? {
                borderColor: 'hsl(var(--dc-blocked))',
                background: 'hsl(var(--dc-blocked) / 0.14)',
                color: 'hsl(var(--dc-ink))',
              }
            : { borderColor: 'hsl(var(--dc-line) / 0.12)', color: 'hsl(var(--dc-muted))' }
        }
      >
        <span className="dc-dot" style={{ background: BLOCKED_DOT }} />
        Blocked
        {blockedCount > 0 && (
          <span
            className="dc-mono rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: 'hsl(var(--dc-blocked) / 0.16)', color: BLOCKED_DOT }}
          >
            {blockedCount}
          </span>
        )}
      </button>

      <button
        onClick={onToggleIndex}
        className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[12.5px] font-medium"
        style={
          indexOpen
            ? {
                borderColor: 'hsl(var(--dc-violet) / 0.6)',
                background: 'hsl(var(--dc-violet) / 0.16)',
                color: 'hsl(var(--dc-ink))',
              }
            : { borderColor: 'hsl(var(--dc-line) / 0.12)', color: 'hsl(var(--dc-muted))' }
        }
      >
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
          <g fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2 3.5h10M2 7h10M2 10.5h6" />
          </g>
        </svg>
        Options index
      </button>

      <button
        onClick={onToggleSketch}
        className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[12.5px] font-medium"
        style={
          sketchOpen || preview
            ? {
                borderColor: 'hsl(var(--dc-violet) / 0.6)',
                background: 'hsl(var(--dc-violet) / 0.16)',
                color: 'hsl(var(--dc-ink))',
              }
            : { borderColor: 'hsl(var(--dc-line) / 0.12)', color: 'hsl(var(--dc-muted))' }
        }
      >
        <FileText className="h-3.5 w-3.5" />
        Markdown
      </button>

      <button
        onClick={onToggleFilling}
        title={filling ? 'Leave full screen (Esc)' : 'Fill the window'}
        aria-label={filling ? 'Leave full screen' : 'Fill the window'}
        className="flex items-center gap-2 rounded-[9px] border px-2.5 py-2"
        style={
          filling
            ? {
                borderColor: 'hsl(var(--dc-violet) / 0.6)',
                background: 'hsl(var(--dc-violet) / 0.16)',
                color: 'hsl(var(--dc-ink))',
              }
            : { borderColor: 'hsl(var(--dc-line) / 0.12)', color: 'hsl(var(--dc-muted))' }
        }
      >
        {filling ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  )
}

function Legend() {
  const items: [string, string][] = [
    ['NOT STARTED', DOT.todo],
    ['IN PROGRESS', DOT.in_progress],
    ['DONE', DOT.done],
    ['BLOCKED', BLOCKED_DOT],
  ]

  return (
    <div
      className="absolute left-6 top-5 z-[6] flex items-center gap-3.5 rounded-[9px] border px-3 py-2"
      style={{
        borderColor: 'hsl(var(--dc-line) / 0.1)',
        background: 'hsl(var(--dc-chrome) / 0.85)',
      }}
    >
      {items.map(([label, colour]) => (
        <span key={label} className="dc-eyebrow flex items-center gap-1.5 !tracking-[0.1em]">
          <span className="dc-dot !h-[7px] !w-[7px]" style={{ background: colour }} />
          {label}
        </span>
      ))}
    </div>
  )
}

function Spotlight({
  rect,
  title,
  chip,
  tone,
}: {
  rect?: Rect
  title: string
  chip: string
  tone?: 'blocked'
}) {
  if (!rect) return null

  const accent = tone === 'blocked' ? 'hsl(var(--dc-blocked))' : 'hsl(var(--dc-violet))'
  const style: CSSProperties = { left: rect.x, top: rect.y, minWidth: rect.w }

  return (
    <div className="absolute z-[9] flex flex-col items-start gap-1.5" style={style}>
      <div
        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl border px-4"
        style={{
          height: rect.h,
          borderColor: accent,
          background: 'hsl(var(--dc-card))',
          boxShadow: `0 0 0 4px ${tone === 'blocked' ? 'hsl(var(--dc-blocked) / 0.18)' : 'hsl(var(--dc-violet) / 0.18)'}`,
        }}
      >
        <span className="dc-dot" style={{ background: accent }} />
        <span className="text-[13px] font-medium" style={{ color: 'hsl(var(--dc-ink))' }}>
          {title}
        </span>
      </div>
      <span
        className="dc-mono whitespace-nowrap rounded-[5px] px-1.5 py-1 text-[9px] font-semibold tracking-[0.1em]"
        style={{ background: accent, color: 'hsl(var(--dc-canvas))' }}
      >
        {chip}
      </span>
    </div>
  )
}

function BlockedRollup({
  rows,
  onPick,
}: {
  rows: { id: number; title: string; where: string; offCanvas: boolean; waitingOn: string[] }[]
  onPick: (id: number) => void
}) {
  return (
    <div
      className="absolute left-6 top-6 z-[14] max-h-[70%] w-[296px] overflow-auto rounded-xl border p-4"
      style={{
        borderColor: 'hsl(var(--dc-blocked) / 0.45)',
        background: 'hsl(var(--dc-chrome))',
        boxShadow: '0 24px 60px -28px rgb(0 0 0 / 0.6)',
      }}
    >
      <div className="dc-eyebrow" style={{ color: BLOCKED_DOT }}>
        BLOCKED · {plural(rows.length, 'FEATURE')}
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => onPick(row.id)}
            className="rounded-[10px] border px-3 py-2.5 text-left"
            style={{
              borderColor: 'hsl(var(--dc-blocked) / 0.35)',
              background: 'hsl(var(--dc-line) / 0.03)',
            }}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-medium" style={{ color: 'hsl(var(--dc-ink))' }}>
                {row.title}
              </span>
              {row.where && (
                <span className="dc-mono text-[9.5px]" style={{ color: 'hsl(var(--dc-faint))' }}>
                  in {row.where}
                </span>
              )}
              {row.offCanvas && (
                <span className="dc-mono text-[9.5px]" style={{ color: 'hsl(var(--dc-violet-2))' }}>
                  open
                </span>
              )}
            </div>
            <div
              className="dc-mono mt-1 text-[10px]"
              style={{ color: 'hsl(var(--dc-muted))' }}
            >
              waiting on {row.waitingOn.join(' · ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function HoverCard({ node, rect, tree }: { node: GraphNode; rect?: Rect; tree: Tree }) {
  if (!rect) return null

  const level = tree.levelOf.get(node.id) ?? 0
  const parent = tree.parentOf.get(node.id)
  const where = parent !== undefined ? `L${level} · in ${tree.byId.get(parent)?.title}` : `L${level}`

  return (
    <div
      className="pointer-events-none absolute z-[13] w-[250px] rounded-xl border p-4"
      style={{
        left: rect.x + rect.w / 2,
        top: Math.max(rect.y - 14, 8),
        transform: 'translate(-50%, -100%)',
        borderColor: 'hsl(var(--dc-violet) / 0.38)',
        background: 'hsl(var(--dc-chrome))',
        boxShadow: '0 24px 60px -28px rgb(0 0 0 / 0.6)',
      }}
    >
      <div className="text-[13.5px] font-semibold" style={{ color: 'hsl(var(--dc-ink-2))' }}>
        {node.title}
      </div>
      <div className="dc-mono mt-1.5 text-[10.5px] font-medium" style={{ color: 'hsl(var(--dc-muted))' }}>
        {STATUS_LABEL[node.status] ?? node.status} · {node.category || 'general'} · {where}
      </div>
      {node.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="dc-chip !tracking-normal">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailPanel({
  node,
  tree,
  readOnly,
  blockedBy,
  blocks,
  onClose,
  onAddDependency,
  onAddChild,
  onOpen,
}: {
  node: GraphNode
  tree: Tree
  readOnly: boolean
  blockedBy: string[]
  blocks: string[]
  onClose: () => void
  onAddDependency: () => void
  onAddChild: () => void
  onOpen: () => void
}) {
  const level = tree.levelOf.get(node.id) ?? 0
  const parent = tree.parentOf.get(node.id)

  return (
    <div
      className="dc-panel absolute bottom-0 right-0 top-0 z-[15] flex w-[300px] flex-col border-l"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b px-5 py-5" style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}>
        <div className="flex items-center justify-between">
          <span className="dc-chip dc-chip-root">
            L{level}
            {parent !== undefined && ` · in ${tree.byId.get(parent)?.title}`}
          </span>
          <button onClick={onClose} aria-label="Close" style={{ color: 'hsl(var(--dc-faint))' }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="mt-3.5 text-[21px] font-semibold leading-tight tracking-[-0.4px]"
          style={{ color: 'hsl(var(--dc-ink-2))' }}
        >
          {node.title}
        </div>

        <div className="mt-3.5 flex flex-wrap gap-2">
          <span
            className="dc-mono flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[11px] font-medium"
            style={{ borderColor: 'hsl(var(--dc-line) / 0.1)', color: 'hsl(var(--dc-muted))' }}
          >
            <span className="dc-dot !h-[7px] !w-[7px]" style={{ background: DOT[node.status] }} />
            {(STATUS_LABEL[node.status] ?? node.status).toUpperCase()}
          </span>
          <span
            className="dc-mono rounded-[7px] border px-2.5 py-1.5 text-[11px] font-medium"
            style={{ borderColor: 'hsl(var(--dc-line) / 0.1)', color: 'hsl(var(--dc-muted))' }}
          >
            {(node.category || 'general').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <PanelList
          label="BLOCKED BY"
          items={blockedBy}
          empty="Nothing — this can start now"
          direction="down"
        />
        <PanelList
          label="BLOCKS"
          hint="breaks downstream if this slips"
          items={blocks}
          empty="Nothing downstream"
          direction="up"
        />

        <div className="px-5 py-4">
          <div className="flex items-baseline gap-2">
            <span className="dc-eyebrow">OPTIONS</span>
            <span className="text-[11px]" style={{ color: 'hsl(var(--dc-faint))' }}>
              not on the canvas
            </span>
          </div>
          <div
            className="mt-3 rounded-[9px] border border-dashed px-3 py-4 text-[11.5px] leading-relaxed"
            style={{ borderColor: 'hsl(var(--dc-line) / 0.16)', color: 'hsl(var(--dc-muted))' }}
          >
            Settings and limits — a time window, a cap, a list of choices — belong to a feature but
            are not features themselves, so they live here rather than as cards on the map.
            FeaturePlus does not record them yet.
          </div>
        </div>
      </div>

      <div
        className="flex flex-col gap-2.5 border-t px-5 py-3.5"
        style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}
      >
        {readOnly ? (
          <p className="text-center text-[11.5px]" style={{ color: 'hsl(var(--dc-faint))' }}>
            Previewing markdown — edit the document to change this.
          </p>
        ) : (
        <>
        <div className="flex gap-2.5">
          <button
            onClick={onAddDependency}
            className="flex-1 rounded-[9px] py-2.5 text-[12.5px] font-semibold text-white"
            style={{ background: 'hsl(var(--dc-violet))' }}
          >
            Add dependency
          </button>
          <button
            onClick={onAddChild}
            className="flex-1 rounded-[9px] border py-2.5 text-[12.5px] font-semibold"
            style={{
              borderColor: 'hsl(var(--dc-violet) / 0.45)',
              color: 'hsl(var(--dc-violet-2))',
            }}
          >
            + Add child
          </button>
        </div>
        <button
          onClick={onOpen}
          className="py-0.5 text-[11.5px] font-medium"
          style={{ color: 'hsl(var(--dc-muted))' }}
        >
          Open feature
        </button>
        </>
        )}
      </div>
    </div>
  )
}

function PanelList({
  label,
  hint,
  items,
  empty,
  direction,
}: {
  label: string
  hint?: string
  items: string[]
  empty: string
  direction: 'up' | 'down'
}) {
  return (
    <div className="border-b px-5 py-4" style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}>
      <div className="flex items-baseline gap-2">
        <span className="dc-eyebrow">{label}</span>
        {hint && (
          <span className="text-[11px]" style={{ color: 'hsl(var(--dc-faint))' }}>
            {hint}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {items.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'hsl(var(--dc-faint))' }}>
            {empty}
          </div>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="flex items-center gap-2.5 rounded-[9px] border px-3 py-2.5 text-[12.5px] font-medium"
              style={{
                borderColor: 'hsl(var(--dc-line) / 0.08)',
                background: 'hsl(var(--dc-line) / 0.035)',
                color: 'hsl(var(--dc-ink))',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" className="flex-none" aria-hidden>
                <path
                  d={direction === 'down' ? 'M6 1 V8 M3 5.5 L6 9 L9 5.5' : 'M6 11 V4 M3 6.5 L6 3 L9 6.5'}
                  fill="none"
                  stroke={direction === 'down' ? 'hsl(var(--dc-violet-2))' : 'hsl(var(--dc-doing))'}
                  strokeWidth="1.4"
                />
              </svg>
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function OptionsIndex({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="dc-panel absolute bottom-0 right-0 top-0 z-[15] flex w-[330px] flex-col border-l"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b px-5 py-5" style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold" style={{ color: 'hsl(var(--dc-ink-2))' }}>
            Options index
          </span>
          <button onClick={onClose} aria-label="Close" style={{ color: 'hsl(var(--dc-faint))' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'hsl(var(--dc-muted))' }}>
          Every option in the product, queried by type across all branches.
        </p>
      </div>

      <div className="flex flex-1 items-center px-5 py-6">
        <p className="text-[12px] leading-relaxed" style={{ color: 'hsl(var(--dc-muted))' }}>
          Nothing to list yet. This reads the settings and limits attached to features — a duration,
          a count, a size, a list of choices — so one question like &ldquo;every time limit in the
          product&rdquo; can be answered from the map. FeaturePlus has no place to record them yet,
          so the index stays empty until it does.
        </p>
      </div>
    </div>
  )
}

/**
 * Where a map gets written by hand.
 *
 * Typing redraws as you go, so trying a different shape is a matter of moving
 * a line rather than creating a project and clicking through it.
 */
function SketchPanel({
  value,
  problems,
  counts,
  onChange,
  onClose,
}: {
  value: string | null
  problems: string[]
  counts: { features: number; dependencies: number }
  onChange: (value: string | null) => void
  onClose: () => void
}) {
  const active = value !== null

  const readFile = async (file: File | undefined) => {
    if (!file) return
    onChange(await file.text())
  }

  return (
    <div
      className="dc-panel absolute bottom-0 right-0 top-0 z-[15] flex w-[420px] flex-col border-l"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b px-5 py-5" style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold" style={{ color: 'hsl(var(--dc-ink-2))' }}>
            Markdown
          </span>
          <button onClick={onClose} aria-label="Close" style={{ color: 'hsl(var(--dc-faint))' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'hsl(var(--dc-muted))' }}>
          Draw a map by typing one. Indent a bullet to put it inside the one above;{' '}
          <code className="dc-mono text-[11px]">needs:</code> adds a dependency by name, which can
          reach into another branch. Headings are ignored.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onChange(MARKDOWN_EXAMPLE)}
            className="rounded-[7px] border px-2.5 py-1.5 text-[11.5px] font-medium"
            style={{
              borderColor: 'hsl(var(--dc-violet) / 0.45)',
              color: 'hsl(var(--dc-violet-2))',
            }}
          >
            Load an example
          </button>
          <label
            className="cursor-pointer rounded-[7px] border px-2.5 py-1.5 text-[11.5px] font-medium"
            style={{ borderColor: 'hsl(var(--dc-line) / 0.14)', color: 'hsl(var(--dc-muted))' }}
          >
            Open a file
            <input
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </label>
          {active && (
            <button
              onClick={() => onChange(null)}
              className="rounded-[7px] border px-2.5 py-1.5 text-[11.5px] font-medium"
              style={{ borderColor: 'hsl(var(--dc-line) / 0.14)', color: 'hsl(var(--dc-muted))' }}
            >
              Back to the project
            </button>
          )}
        </div>
      </div>

      <textarea
        value={value ?? ''}
        spellCheck={false}
        placeholder={SKETCH_PLACEHOLDER}
        onChange={(event) => onChange(event.target.value)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void readFile(event.dataTransfer.files?.[0])
        }}
        className="dc-mono flex-1 resize-none bg-transparent px-5 py-4 text-[12px] leading-[1.7] outline-none"
        style={{ color: 'hsl(var(--dc-ink))' }}
      />

      <div className="border-t px-5 py-3" style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}>
        {active && (
          <div className="dc-eyebrow">
            {counts.features} {counts.features === 1 ? 'FEATURE' : 'FEATURES'} ·{' '}
            {counts.dependencies}{' '}
            {counts.dependencies === 1 ? 'DEPENDENCY' : 'DEPENDENCIES'}
          </div>
        )}
        {problems.length > 0 && (
          <ul className="mt-2 max-h-28 space-y-1 overflow-auto">
            {problems.map((problem) => (
              <li key={problem} className="text-[11.5px]" style={{ color: BLOCKED_DOT }}>
                {problem}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EdgeActions({
  edge,
  tree,
  readOnly,
  busy,
  onRemove,
  onDismiss,
}: {
  edge: RoutedEdge
  tree: Tree
  readOnly: boolean
  busy: boolean
  onRemove: () => void
  onDismiss: () => void
}) {
  const from = tree.byId.get(edge.from)?.title ?? 'a feature'
  const to = tree.byId.get(edge.to)?.title ?? 'a feature'
  const lifted = edge.ids.length > 1

  return (
    <div
      className="dc-panel absolute bottom-20 left-1/2 z-[16] flex -translate-x-1/2 items-center gap-3 rounded-lg border px-3 py-2"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="text-xs" style={{ color: 'hsl(var(--dc-muted))' }}>
        {edge.inCycle && <AlertTriangle className="mr-1.5 inline h-3 w-3 text-warning" />}
        <span style={{ color: 'hsl(var(--dc-ink))' }}>{to}</span> waits on{' '}
        <span style={{ color: 'hsl(var(--dc-ink))' }}>{from}</span>
        {lifted && ` · ${plural(edge.ids.length, 'dependency', 'dependencies')}`}
      </span>
      {!readOnly && (
        <Button variant="danger" size="sm" className="h-7" loading={busy} onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
          {lifted ? 'Remove all' : 'Remove'}
        </Button>
      )}
      <button onClick={onDismiss} aria-label="Deselect" className="text-faint hover:text-ink">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function BottomBar({
  connectedOnly,
  hideDone,
  onConnectedOnly,
  onToggleHideDone,
  onReset,
}: {
  connectedOnly: boolean
  hideDone: boolean
  onConnectedOnly: (value: boolean) => void
  onToggleHideDone: () => void
  onReset: () => void
}) {
  const pill = (active: boolean): CSSProperties =>
    active
      ? { background: 'hsl(var(--dc-violet) / 0.9)', color: '#fff', fontWeight: 600 }
      : { color: 'hsl(var(--dc-muted))' }

  return (
    <div
      className="dc-panel absolute bottom-5 left-1/2 z-[12] flex w-fit -translate-x-1/2 items-center gap-1 rounded-[13px] border p-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        onClick={() => onConnectedOnly(false)}
        className="rounded-[9px] px-3.5 py-2 text-[12.5px]"
        style={pill(!connectedOnly)}
      >
        All features
      </button>
      <button
        onClick={() => onConnectedOnly(true)}
        className="rounded-[9px] px-3.5 py-2 text-[12.5px]"
        style={pill(connectedOnly)}
      >
        Connected only
      </button>
      <span className="mx-1 h-5 w-px" style={{ background: 'hsl(var(--dc-line) / 0.12)' }} />
      <button
        onClick={onToggleHideDone}
        aria-pressed={hideDone}
        className="rounded-[9px] px-3.5 py-2 text-[12.5px]"
        style={pill(hideDone)}
      >
        Hide done
      </button>
      <button
        onClick={onReset}
        className="rounded-[9px] px-3.5 py-2 text-[12.5px]"
        style={{ color: 'hsl(var(--dc-muted))' }}
      >
        Reset view
      </button>
    </div>
  )
}

function Banner({
  tone,
  onDismiss,
  children,
}: {
  tone: 'danger' | 'warning'
  onDismiss: () => void
  children: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'danger'
          ? 'border-danger/30 bg-danger-soft text-danger'
          : 'border-warning/40 bg-warning-soft text-ink',
      )}
    >
      <span className="flex-1">{children}</span>
      <button onClick={onDismiss} aria-label="Dismiss">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function EmptyCanvas({
  preview,
  hasFeatures,
  filtered,
  onClearFilters,
}: {
  preview: boolean
  hasFeatures: boolean
  filtered: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <svg width="76" height="70" viewBox="0 0 76 70" className="mx-auto opacity-50" aria-hidden>
          <g fill="none" stroke="hsl(var(--dc-violet))" strokeWidth="1.4">
            <rect x="26" y="6" width="24" height="9" rx="3" />
            <rect x="8" y="30" width="24" height="9" rx="3" strokeDasharray="3 4" />
            <rect x="44" y="30" width="24" height="9" rx="3" strokeDasharray="3 4" />
            <rect x="26" y="54" width="24" height="9" rx="3" strokeDasharray="3 4" />
          </g>
        </svg>
        <p className="mt-4 text-base font-semibold" style={{ color: 'hsl(var(--dc-ink))' }}>
          {preview
            ? 'Nothing in the markdown yet'
            : filtered
              ? 'Nothing is connected yet'
              : 'Nothing to draw yet'}
        </p>
        <p
          className="mx-auto mt-2 max-w-sm text-[12.5px] leading-relaxed"
          style={{ color: 'hsl(var(--dc-muted))' }}
        >
          {preview
            ? 'Write a bullet per feature. Indent one to put it inside the one above it.'
            : filtered
            ? 'No feature in this project has a dependency at either end.'
            : hasFeatures
              ? 'This project has features but nothing depends on anything yet. Drag from the dot under one card onto another to record the first dependency.'
              : 'This project has no features, so there is nothing to depend on anything.'}
        </p>
        {filtered && !preview && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={onClearFilters}>
            Show all features
          </Button>
        )}
      </div>
    </div>
  )
}
