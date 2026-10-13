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
  Download,
  FileText,
  Info,
  Maximize2,
  Minimize2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCreateDependency,
  useCreateFeature,
  useDeleteDependency,
  useDeleteFeature,
  useDependencyGraph,
  useProject,
  useUpdateFeature,
} from '@/lib/queries'
import { downloadFeatureFile, FEATURE_FILE_NAME } from '@/lib/feature-file'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
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
import { type GraphNode } from '@/lib/types'
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

// Progress (to do / in progress / done) is not drawn on the map: the canvas is
// for shaping features and their dependencies, and progress lives on the
// feature page. Blocked is the exception, because it comes from the arrows.
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
  const createFeature = useCreateFeature(projectId)
  const updateFeature = useUpdateFeature(projectId)
  const deleteFeature = useDeleteFeature(projectId)

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [blockedMode, setBlockedMode] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [connectedOnly, setConnectedOnly] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState<RoutedEdge | null>(null)
  // The top-level quick-add box, opened from the header.
  const [addingTop, setAddingTop] = useState(false)
  // A double-clicked card opens its panel with the name ready to edit.
  const [renameId, setRenameId] = useState<number | null>(null)
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

  // What each feature waits on and what waits on it, for the panel. Each
  // entry keeps the dependency's id so the panel can remove it.
  const relations = useMemo(() => {
    const blockedBy = new Map<number, Relation[]>()
    const blocks = new Map<number, Relation[]>()
    for (const edge of allEdges) {
      const parent = tree.byId.get(edge.parent_id)
      const child = tree.byId.get(edge.child_id)
      if (!parent || !child) continue
      blockedBy.set(child.id, [
        ...(blockedBy.get(child.id) ?? []),
        { edgeId: edge.id, featureId: parent.id, title: parent.title },
      ])
      blocks.set(parent.id, [
        ...(blocks.get(parent.id) ?? []),
        { edgeId: edge.id, featureId: child.id, title: child.title },
      ])
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

  // Fit to screen shrinks the map with CSS zoom. Cards are still measured in
  // screen pixels, so measurements are divided by the zoom to get back to the
  // map's own coordinates, which is what the arrows are drawn in.
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom

  const [pos, setPos] = useState<Map<number, Rect>>(new Map())
  const [canvasWidth, setCanvasWidth] = useState(1200)
  const posKey = useRef('')

  // Keeping the map steady. Every edit re-lays the map out — that is what
  // makes a card sit below what it waits on — so cards do move. What must not
  // move is the card being worked on: before an edit its place on screen is
  // remembered, and after each repaint the canvas scrolls so it is back there.
  // The hold lasts a moment, long enough for the server's answer to arrive.
  const anchor = useRef<{ id: number; top: number; left: number; until: number } | null>(null)

  const holdSteady = useCallback((id: number | null | undefined) => {
    const canvas = canvasRef.current
    const el = id == null ? null : canvas?.querySelector<HTMLElement>(`[data-node="${id}"]`)
    if (id == null || !el) {
      anchor.current = null
      return
    }
    const box = el.getBoundingClientRect()
    anchor.current = { id, top: box.top, left: box.left, until: Date.now() + 2500 }
  }, [])

  // A new top-level feature lands wherever the layout puts it, often in the
  // independent corral at the bottom. It is scrolled into view once it exists.
  const reveal = useRef<number | null>(null)

  const measure = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const held = anchor.current
    if (held) {
      const el = canvas.querySelector<HTMLElement>(`[data-node="${held.id}"]`)
      if (Date.now() > held.until || !el) {
        anchor.current = null
      } else {
        const box = el.getBoundingClientRect()
        canvas.scrollTop += box.top - held.top
        canvas.scrollLeft += box.left - held.left
      }
    }

    if (reveal.current !== null) {
      const el = canvas.querySelector<HTMLElement>(`[data-node="${reveal.current}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        reveal.current = null
      }
    }

    const origin = canvas.getBoundingClientRect()
    const next = new Map<number, Rect>()
    for (const el of canvas.querySelectorAll<HTMLElement>('[data-node]')) {
      const box = el.getBoundingClientRect()
      const z = zoomRef.current
      next.set(Number(el.dataset.node), {
        x: Math.round((box.left - origin.left + canvas.scrollLeft) / z),
        y: Math.round((box.top - origin.top + canvas.scrollTop) / z),
        w: Math.round(box.width / z),
        h: Math.round(box.height / z),
      })
    }

    const key = JSON.stringify([zoomRef.current, ...next])
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
  }, [measure, visible])

  const routed = useMemo(
    () => routeEdges(tree, lifted, pos, canvasWidth),
    [tree, lifted, pos, canvasWidth],
  )

  // Picking a feature narrows the map to its chain. Without this a map of a
  // hundred features is a wall of arrows: the picture can show every path at
  // once, but it cannot show you *one*.
  const focus = useMemo(() => {
    if (selected === null) return null
    const chain = chainFrom(tree, selected, lifted)
    // What is inside the picked feature stays bright too: those are the
    // features being worked on, often ones that were only just added.
    const stack = [...(tree.childrenOf.get(selected) ?? [])]
    const seen = new Set<number>()
    while (stack.length > 0) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      chain.nodes.add(id)
      stack.push(...(tree.childrenOf.get(id) ?? []))
    }
    return chain
  }, [selected, tree, lifted])

  function toggleFit() {
    const canvas = canvasRef.current
    if (!canvas) return
    if (zoom < 1) {
      setZoom(1)
      return
    }
    // The map's natural size is its scroll size at full scale.
    const fit = Math.min(
      canvas.clientWidth / canvas.scrollWidth,
      canvas.clientHeight / canvas.scrollHeight,
      1,
    )
    setZoom(Math.max(0.3, Math.floor(fit * 100) / 100))
  }

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

  // A match already on the map may be scrolled out of sight, where its
  // highlight helps nobody. The first one is brought into view as you type.
  const firstOnCanvas = matches.onCanvas[0]
  useEffect(() => {
    if (firstOnCanvas === undefined) return
    canvasRef.current
      ?.querySelector<HTMLElement>(`[data-node="${firstOnCanvas}"]`)
      ?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }, [firstOnCanvas])

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
      reveal.current = id
    },
    [tree],
  )

  // Dependencies are added and removed by name in the side panel, not drawn.
  // Drawing made it too easy to leave a wrong arrow behind: a drag that
  // started a few pixels off a card, or a click on the wrong card after
  // "Add dependency". The canvas only shows the arrows.

  /** `waiter` cannot start until `blocker` is finished. Throws on failure. */
  async function addDependency(blocker: number, waiter: number) {
    setWarning('')
    holdSteady(waiter)
    const created = await createDependency.mutateAsync({ parent_id: blocker, child_id: waiter })
    if (created.creates_cycle) {
      setWarning('That dependency closes a loop. The features now wait on each other.')
    }
  }

  async function removeDependency(edgeId: number, keepInView: number) {
    holdSteady(keepInView)
    await deleteDependency.mutateAsync(edgeId)
  }

  /** Add a feature by name only; details can be filled in later. */
  async function addFeature(title: string, parentId?: number) {
    if (parentId !== undefined) holdSteady(parentId)
    const created = await createFeature.mutateAsync({
      title,
      ...(parentId !== undefined ? { parent_feature_id: parentId } : {}),
    })
    // A child added to a closed card should be seen, so its parent opens.
    if (parentId !== undefined) setExpanded((current) => new Set(current).add(parentId))
    else reveal.current = created.id
  }

  async function renameFeature(id: number, title: string) {
    holdSteady(id)
    await updateFeature.mutateAsync({ id, title })
  }

  async function removeFeature(id: number) {
    holdSteady(tree.parentOf.get(id))
    await deleteFeature.mutateAsync(id)
    setSelected(null)
  }

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
    setSelectedEdge(null)
    setZoom(1)
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
    blocked,
    blockedWithin,
    lifted,
    connected,
    focus,
    onPick: (id: number) => {
      setSelected(id)
      setIndexOpen(false)
      setHovered(null)
      setSelectedEdge(null)
    },
    onHover: setHovered,
    onToggle: toggle,
    readOnly: preview,
    onRename: (id: number) => {
      if (preview) return
      setSelected(id)
      setRenameId(id)
      setIndexOpen(false)
      setHovered(null)
      setSelectedEdge(null)
    },
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
          onPickFirst={() => {
            const first = matches.onCanvas[0] ?? matches.nested[0]
            if (first !== undefined) revealNested(first)
          }}
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
          projectId={projectId}
          preview={preview}
          sketchOpen={sketchOpen}
          adding={addingTop}
          onToggleAdding={() => {
            setAddingTop((v) => !v)
            setSelected(null)
            setIndexOpen(false)
          }}
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
              onAdd={(title) => addFeature(title)}
            />
          ) : (
            <div
              className="relative flex min-h-full flex-col gap-20 px-6 pb-16 pt-[74px]"
              style={zoom < 1 ? { zoom } : undefined}
            >
              <Legend />

              <EdgeLayer
                edges={routed}
                focus={focus?.keys ?? null}
                selectedId={selectedEdge?.ids[0] ?? null}
                onPick={(edge) => {
                  setSelectedEdge(edge)
                  setSelected(null)
                }}
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

          {addingTop && !preview && tree.roots.length > 0 && (
            <div
              className="dc-panel absolute right-4 top-4 z-[16] w-[320px] rounded-[12px] border p-3"
              style={{ borderColor: 'hsl(var(--dc-violet) / 0.45)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="dc-eyebrow">NEW TOP-LEVEL FEATURE</span>
                <button
                  onClick={() => setAddingTop(false)}
                  aria-label="Close"
                  style={{ color: 'hsl(var(--dc-faint))' }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <QuickAdd
                placeholder="Feature name"
                onAdd={(title) => addFeature(title)}
                onDone={() => setAddingTop(false)}
              />
            </div>
          )}

          {selectedNode && (
            <DetailPanel
              key={selectedNode.id}
              node={selectedNode}
              tree={tree}
              readOnly={preview}
              blockedBy={relations.blockedBy.get(selectedNode.id) ?? []}
              blocks={relations.blocks.get(selectedNode.id) ?? []}
              startRenaming={renameId === selectedNode.id}
              onRenamingDone={() => setRenameId(null)}
              onClose={() => setSelected(null)}
              candidates={dependencyCandidates(tree, selectedNode.id)}
              onAddWaitsOn={(blocker) => addDependency(blocker, selectedNode.id)}
              onAddNeededBy={(waiter) => addDependency(selectedNode.id, waiter)}
              onRemoveDependency={(edgeId) => removeDependency(edgeId, selectedNode.id)}
              onAddChild={(title) => addFeature(title, selectedNode.id)}
              onRename={(title) => renameFeature(selectedNode.id, title)}
              onDelete={() => removeFeature(selectedNode.id)}
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

        </div>

        <div className="dc-chrome flex items-center gap-2.5 border-t px-5 py-2 text-xs text-muted">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {preview
              ? 'Previewing a map written by hand. Indentation nests a feature inside another; "needs:" adds a dependency. Nothing here is saved to the project.'
              : 'Click a card to add features inside it, rename it, delete it, or set what it waits on. An arrow means "waits on"; a box means "inside".'}
          </span>
          {tree.roots.length > 0 && (preview || !graph.isLoading) && (
            <BottomBar
              connectedOnly={connectedOnly}
              onConnectedOnly={setConnectedOnly}
              onReset={reset}
              fitted={zoom < 1}
              onToggleFit={toggleFit}
            />
          )}
        </div>
      </div>

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
  /** Double-click: select a feature with its name ready to edit. */
  onRename: (id: number) => void
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
              <span className="dc-corral-tag dc-eyebrow">NO DEPENDENCIES</span>
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
      <div className="dc-branch-tag select-none">
        {ctx.blockedWithin(id) && (
          <span className="dc-dot !h-[7px] !w-[7px]" style={{ background: BLOCKED_DOT }} />
        )}
        <button
          onClick={(event) => {
            event.stopPropagation()
            ctx.onPick(id)
          }}
          onDoubleClick={(event) => {
            event.stopPropagation()
            ctx.onRename(id)
          }}
          className="text-[11.5px] font-semibold"
          style={{ color: 'hsl(var(--dc-violet-2))' }}
        >
          {node.title}
        </button>
        <span
          className="dc-mono text-[9px] font-medium"
          style={{ color: 'hsl(var(--dc-violet-2) / 0.75)' }}
          title={`${plural(children.length, 'feature')} inside`}
        >
          {children.length}
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

  const blockedHere = ctx.blocked.has(id) || (children.length > 0 && ctx.blockedWithin(id))

  return (
    <div
      data-node={id}
      onClick={(event) => {
        event.stopPropagation()
        ctx.onPick(id)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        ctx.onRename(id)
      }}
      onMouseEnter={() => ctx.onHover(id)}
      onMouseLeave={() => ctx.onHover(null)}
      className={cn(
        'select-none',
        independent ? 'dc-card-indep' : isRoot ? 'dc-card-root' : isAnchor ? 'dc-card-anchor' : 'dc-card',
        ctx.focus && !ctx.focus.nodes.has(id) && 'dc-dim',
        ctx.selected === id && 'dc-sel',
        blockedHere && !ctx.selected && 'dc-cycle',
      )}
    >
      {blockedHere && <span className="dc-dot" style={{ background: BLOCKED_DOT }} />}
      <span className="dc-name" title={node.title}>
        {node.title}
      </span>


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

    </div>
  )
}

// --- Arrows -----------------------------------------------------------------

function EdgeLayer({
  edges,
  focus,
  selectedId,
  onPick,
}: {
  edges: RoutedEdge[]
  focus: Set<string> | null
  selectedId: number | null
  onPick: (edge: RoutedEdge) => void
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

    </svg>
  )
}

// --- Chrome -----------------------------------------------------------------

/** Saves the project's features as FEATURES.md, ready to commit to the repo. */
function DownloadFileButton({ projectId }: { projectId: number }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')

  async function download() {
    setState('busy')
    try {
      await downloadFeatureFile(projectId)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <button
      onClick={download}
      disabled={state === 'busy'}
      title={state === 'failed' ? 'Download failed. Click to try again.' : `Save the feature list as ${FEATURE_FILE_NAME}`}
      className="flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[12.5px] font-medium"
      style={
        state === 'failed'
          ? { borderColor: 'hsl(var(--dc-blocked) / 0.6)', color: 'hsl(var(--dc-blocked))' }
          : { borderColor: 'hsl(var(--dc-line) / 0.12)', color: 'hsl(var(--dc-muted))' }
      }
    >
      {state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {state === 'failed' ? 'Download failed' : 'Download .md'}
    </button>
  )
}

function Header({
  projectName,
  query,
  onQuery,
  onPickFirst,
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
  projectId,
  preview,
  sketchOpen,
  onToggleSketch,
  adding,
  onToggleAdding,
}: {
  projectName: string
  query: string
  onQuery: (value: string) => void
  onPickFirst: () => void
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
  projectId: number
  preview: boolean
  sketchOpen: boolean
  onToggleSketch: () => void
  adding: boolean
  onToggleAdding: () => void
}) {
  // Levels have no fixed limit, so the control offers every level there is.
  const levels = Array.from({ length: maxLevel + 1 }, (_, i) => i)

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

      {!preview && (
        <button
          onClick={onToggleAdding}
          className="flex items-center gap-1.5 rounded-[9px] border px-3 py-2 text-[12.5px] font-semibold"
          style={
            adding
              ? { borderColor: 'hsl(var(--dc-violet))', background: 'hsl(var(--dc-violet))', color: '#fff' }
              : { borderColor: 'hsl(var(--dc-violet) / 0.45)', color: 'hsl(var(--dc-violet-2))' }
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Feature
        </button>
      )}

      <div
        className="relative flex w-[180px] items-center gap-2 rounded-[9px] border px-3 py-2"
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
            // Enter selects the first match, the same as clicking it.
            if (event.key === 'Enter') onPickFirst()
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

      {!preview && <DownloadFileButton projectId={projectId} />}

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
  const items: [string, string][] = [['BLOCKED · WAITING ON SOMETHING UNFINISHED', BLOCKED_DOT]]

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
        {node.category || 'general'} · {where}
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
  candidates,
  startRenaming,
  onRenamingDone,
  onClose,
  onAddWaitsOn,
  onAddNeededBy,
  onRemoveDependency,
  onAddChild,
  onRename,
  onDelete,
  onOpen,
}: {
  node: GraphNode
  tree: Tree
  readOnly: boolean
  blockedBy: Relation[]
  blocks: Relation[]
  candidates: Candidate[]
  startRenaming: boolean
  onRenamingDone: () => void
  onClose: () => void
  onAddWaitsOn: (featureId: number) => Promise<void>
  onAddNeededBy: (featureId: number) => Promise<void>
  onRemoveDependency: (edgeId: number) => Promise<void>
  onAddChild: (title: string) => Promise<void>
  onRename: (title: string) => Promise<void>
  onDelete: () => Promise<void>
  onOpen: () => void
}) {
  const level = tree.levelOf.get(node.id) ?? 0
  const parent = tree.parentOf.get(node.id)
  const childCount = tree.childrenOf.get(node.id)?.length ?? 0

  const [renaming, setRenaming] = useState(startRenaming && !readOnly)

  // A double-click selects the card on its first click, so the panel is
  // usually already open when the request to rename arrives.
  useEffect(() => {
    if (startRenaming && !readOnly) setRenaming(true)
  }, [startRenaming, readOnly])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : failure)
      return false
    } finally {
      setBusy(false)
    }
  }

  // Escape closes the name box, which can also fire its blur on the way out;
  // this keeps that blur from saving what Escape meant to throw away.
  const cancelRename = useRef(false)

  async function saveName(value: string) {
    if (cancelRename.current) {
      cancelRename.current = false
      return
    }
    const title = value.trim()
    setRenaming(false)
    onRenamingDone()
    if (!title || title === node.title) return
    await run(() => onRename(title), 'Could not rename this feature')
  }

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

        {renaming ? (
          <input
            autoFocus
            defaultValue={node.title}
            maxLength={255}
            aria-label="Feature name"
            onFocus={(event) => {
              cancelRename.current = false
              event.currentTarget.select()
            }}
            onBlur={(event) => void saveName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                // Escape here cancels the rename only, not full screen.
                event.stopPropagation()
                cancelRename.current = true
                setRenaming(false)
                onRenamingDone()
              }
            }}
            className="mt-3 w-full rounded-[8px] border bg-transparent px-2 py-1 text-[19px] font-semibold leading-tight outline-none"
            style={{ borderColor: 'hsl(var(--dc-violet))', color: 'hsl(var(--dc-ink-2))' }}
          />
        ) : (
          <div className="mt-3.5 flex items-start gap-2">
            <div
              className="min-w-0 flex-1 break-words text-[21px] font-semibold leading-tight tracking-[-0.4px]"
              style={{ color: 'hsl(var(--dc-ink-2))' }}
              onDoubleClick={() => !readOnly && setRenaming(true)}
            >
              {node.title}
            </div>
            {!readOnly && (
              <button
                onClick={() => setRenaming(true)}
                title="Rename"
                aria-label="Rename"
                className="mt-1 flex-none rounded-md p-1 hover:bg-[hsl(var(--dc-violet)/0.14)]"
                style={{ color: 'hsl(var(--dc-muted))' }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 text-[11.5px]" style={{ color: 'hsl(var(--dc-blocked))' }}>
            {error}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {!readOnly && (
          <div className="border-b px-5 py-4" style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}>
            <div className="flex items-baseline gap-2">
              <span className="dc-eyebrow">ADD INSIDE</span>
              <span className="text-[11px]" style={{ color: 'hsl(var(--dc-faint))' }}>
                one level deeper
              </span>
            </div>
            <div className="mt-2.5">
              <QuickAdd placeholder={`New feature in ${node.title}`} onAdd={onAddChild} />
            </div>
          </div>
        )}

        <DependencyList
          label="WAITS ON"
          hint="must be finished first"
          items={blockedBy}
          empty="Nothing. This can start any time."
          direction="down"
          readOnly={readOnly}
          candidates={candidates.filter((c) => !blockedBy.some((r) => r.featureId === c.id))}
          placeholder="Add: type a feature name"
          onAdd={onAddWaitsOn}
          onRemove={onRemoveDependency}
        />
        <DependencyList
          label="NEEDED BY"
          hint="waits for this one"
          items={blocks}
          empty="Nothing waits on this yet."
          direction="up"
          readOnly={readOnly}
          candidates={candidates.filter((c) => !blocks.some((r) => r.featureId === c.id))}
          placeholder="Add: type a feature name"
          onAdd={onAddNeededBy}
          onRemove={onRemoveDependency}
        />
      </div>

      <div
        className="flex flex-col gap-2.5 border-t px-5 py-3.5"
        style={{ borderColor: 'hsl(var(--dc-line) / 0.1)' }}
      >
        {readOnly ? (
          <p className="text-center text-[11.5px]" style={{ color: 'hsl(var(--dc-faint))' }}>
            Previewing markdown — edit the document to change this.
          </p>
        ) : confirmingDelete ? (
          <div className="space-y-2.5">
            <p className="text-[12px] leading-relaxed" style={{ color: 'hsl(var(--dc-ink))' }}>
              {childCount > 0
                ? `"${node.title}" has ${plural(childCount, 'feature')} inside it. Delete those first.`
                : `Delete "${node.title}"? Its dependencies go with it. This cannot be undone.`}
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="flex-1 rounded-[9px] border py-2 text-[12.5px] font-semibold"
                style={{ borderColor: 'hsl(var(--dc-line) / 0.2)', color: 'hsl(var(--dc-muted))' }}
              >
                Cancel
              </button>
              {childCount === 0 && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    const ok = await run(onDelete, 'Could not delete this feature')
                    if (!ok) setConfirmingDelete(false)
                  }}
                  className="flex-1 rounded-[9px] py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
                  style={{ background: 'hsl(var(--dc-blocked))' }}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button
                onClick={onOpen}
                className="py-0.5 text-[11.5px] font-medium"
                style={{ color: 'hsl(var(--dc-muted))' }}
              >
                Open feature
              </button>
              <button
                onClick={() => {
                  setError('')
                  setConfirmingDelete(true)
                }}
                className="flex items-center gap-1 py-0.5 text-[11.5px] font-medium"
                style={{ color: 'hsl(var(--dc-blocked))' }}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Add features by name: type, press Enter, type the next. The box stays open
 * and keeps focus, because brainstorming is a run of names, not one at a time.
 * Everything else about a feature can be filled in later on its own page.
 */
function QuickAdd({
  placeholder,
  onAdd,
  onDone,
}: {
  placeholder: string
  onAdd: (title: string) => Promise<void>
  onDone?: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    const title = value.trim()
    if (!title || busy) return
    setBusy(true)
    setError('')
    try {
      await onAdd(title)
      setValue('')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add that feature')
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-[9px] border px-3 py-2"
        style={{ borderColor: 'hsl(var(--dc-line) / 0.16)', background: 'hsl(var(--dc-line) / 0.04)' }}
      >
        <Plus className="h-3.5 w-3.5 flex-none" style={{ color: 'hsl(var(--dc-violet-2))' }} />
        <input
          ref={inputRef}
          autoFocus={onDone !== undefined}
          value={value}
          maxLength={255}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
            if (event.key === 'Escape') {
              // Escape closes this box only, not full screen.
              event.stopPropagation()
              if (value) setValue('')
              else onDone?.()
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] font-medium outline-none"
          style={{ color: 'hsl(var(--dc-ink))' }}
        />
      </div>
      <p className="mt-1.5 text-[10.5px]" style={{ color: error ? 'hsl(var(--dc-blocked))' : 'hsl(var(--dc-faint))' }}>
        {error || 'Enter adds it and keeps the box open for the next one.'}
      </p>
    </div>
  )
}

interface Relation {
  edgeId: number
  featureId: number
  title: string
}

interface Candidate {
  id: number
  title: string
  /** The feature it sits inside, to tell apart two features with one name. */
  where: string
}

/**
 * Features a dependency could point at. A feature cannot wait on itself, on
 * a feature inside it, or on the feature it sits inside: being inside is
 * already "part of", and an arrow between the two would say nothing more.
 */
function dependencyCandidates(tree: Tree, id: number): Candidate[] {
  const excluded = new Set<number>([id])
  let parent = tree.parentOf.get(id)
  while (parent !== undefined && !excluded.has(parent)) {
    excluded.add(parent)
    parent = tree.parentOf.get(parent)
  }
  const stack = [...(tree.childrenOf.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (excluded.has(next)) continue
    excluded.add(next)
    stack.push(...(tree.childrenOf.get(next) ?? []))
  }

  const out: Candidate[] = []
  for (const node of tree.byId.values()) {
    if (excluded.has(node.id)) continue
    const parentId = tree.parentOf.get(node.id)
    out.push({
      id: node.id,
      title: node.title,
      where: parentId !== undefined ? (tree.byId.get(parentId)?.title ?? '') : '',
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

function DependencyList({
  label,
  hint,
  items,
  empty,
  direction,
  readOnly,
  candidates,
  placeholder,
  onAdd,
  onRemove,
}: {
  label: string
  hint?: string
  items: Relation[]
  empty: string
  direction: 'up' | 'down'
  readOnly: boolean
  candidates: Candidate[]
  placeholder: string
  onAdd: (featureId: number) => Promise<void>
  onRemove: (edgeId: number) => Promise<void>
}) {
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<number | null>(null)

  async function remove(edgeId: number) {
    setError('')
    setRemoving(edgeId)
    try {
      await onRemove(edgeId)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not remove that dependency')
    } finally {
      setRemoving(null)
    }
  }

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
          items.map((item) => (
            <div
              key={item.edgeId}
              className="flex items-center gap-2.5 rounded-[9px] border px-3 py-2 text-[12.5px] font-medium"
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
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {!readOnly && (
                <button
                  onClick={() => void remove(item.edgeId)}
                  disabled={removing === item.edgeId}
                  title={`Remove: no longer ${direction === 'down' ? 'waits on' : 'needed by'} ${item.title}`}
                  aria-label={`Remove ${item.title}`}
                  className="flex-none rounded p-0.5 hover:bg-[hsl(var(--dc-blocked)/0.16)] disabled:opacity-40"
                  style={{ color: 'hsl(var(--dc-faint))' }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        )}

        {!readOnly && (
          <FeaturePicker
            candidates={candidates}
            placeholder={placeholder}
            onPick={async (id) => {
              setError('')
              try {
                await onAdd(id)
              } catch (caught) {
                setError(caught instanceof ApiError ? caught.message : 'Could not add that dependency')
              }
            }}
          />
        )}
        {error && (
          <p role="alert" className="text-[11px]" style={{ color: 'hsl(var(--dc-blocked))' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Type part of a name, pick a feature. Only existing features can be picked,
 * so a typo never becomes a dependency on nothing.
 */
function FeaturePicker({
  candidates,
  placeholder,
  onPick,
}: {
  candidates: Candidate[]
  placeholder: string
  onPick: (id: number) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)

  const needle = text.trim().toLowerCase()
  const matches = needle
    ? candidates.filter((c) => c.title.toLowerCase().includes(needle)).slice(0, 6)
    : []

  async function pick(candidate: Candidate | undefined) {
    if (!candidate || busy) return
    setBusy(true)
    try {
      await onPick(candidate.id)
      setText('')
      setActive(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <input
        value={text}
        maxLength={255}
        onChange={(event) => {
          setText(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            void pick(matches[active])
          }
          if (event.key === 'Escape' && text) {
            // Escape clears the box first, and only then leaves full screen.
            event.stopPropagation()
            setText('')
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-[9px] border border-dashed bg-transparent px-3 py-2 text-[12px] outline-none focus:border-solid"
        style={{ borderColor: 'hsl(var(--dc-line) / 0.2)', color: 'hsl(var(--dc-ink))' }}
      />
      {needle && (
        <div
          className="dc-panel absolute left-0 right-0 top-full z-30 mt-1 rounded-[9px] border p-1"
          style={{ borderColor: 'hsl(var(--dc-violet) / 0.35)' }}
        >
          {matches.length === 0 ? (
            <div className="px-2 py-1.5 text-[11.5px]" style={{ color: 'hsl(var(--dc-faint))' }}>
              No feature by that name
            </div>
          ) : (
            matches.map((candidate, index) => (
              <button
                key={candidate.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(candidate)}
                onMouseEnter={() => setActive(index)}
                className="flex w-full items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-left"
                style={index === active ? { background: 'hsl(var(--dc-violet) / 0.16)' } : undefined}
              >
                <span className="truncate text-[12px] font-medium" style={{ color: 'hsl(var(--dc-ink))' }}>
                  {candidate.title}
                </span>
                {candidate.where && (
                  <span className="dc-mono flex-none text-[10px]" style={{ color: 'hsl(var(--dc-violet-2))' }}>
                    in {candidate.where}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
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
  onConnectedOnly,
  onReset,
  fitted,
  onToggleFit,
}: {
  connectedOnly: boolean
  onConnectedOnly: (value: boolean) => void
  onReset: () => void
  fitted: boolean
  onToggleFit: () => void
}) {
  const pill = (active: boolean): CSSProperties =>
    active
      ? { background: 'hsl(var(--dc-violet) / 0.9)', color: '#fff', fontWeight: 600 }
      : { color: 'hsl(var(--dc-muted))' }

  return (
    <div
      className="flex flex-none items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        onClick={() => onConnectedOnly(false)}
        className="rounded-[8px] px-3 py-1.5 text-[12px]"
        style={pill(!connectedOnly)}
      >
        All features
      </button>
      <button
        onClick={() => onConnectedOnly(true)}
        className="rounded-[8px] px-3 py-1.5 text-[12px]"
        style={pill(connectedOnly)}
      >
        Connected only
      </button>
      <span className="mx-1 h-5 w-px" style={{ background: 'hsl(var(--dc-line) / 0.12)' }} />
      <button
        onClick={onToggleFit}
        aria-pressed={fitted}
        title={fitted ? 'Back to actual size' : 'Shrink the map to fit the window'}
        className="rounded-[8px] px-3 py-1.5 text-[12px]"
        style={pill(fitted)}
      >
        {fitted ? 'Actual size' : 'Fit to screen'}
      </button>
      <button
        onClick={onReset}
        className="rounded-[8px] px-3 py-1.5 text-[12px]"
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
  onAdd,
}: {
  preview: boolean
  hasFeatures: boolean
  filtered: boolean
  onClearFilters: () => void
  onAdd: (title: string) => Promise<void>
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
              : 'Start with the big areas of the project. You can add features inside each one afterwards.'}
        </p>
        {filtered && !preview && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={onClearFilters}>
            Show all features
          </Button>
        )}
        {!preview && !filtered && !hasFeatures && (
          <div className="mx-auto mt-5 w-[320px] text-left">
            <QuickAdd placeholder="First feature" onAdd={onAdd} />
          </div>
        )}
      </div>
    </div>
  )
}
