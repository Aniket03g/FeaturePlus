import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  AlertTriangle,
  ArrowLeft,
  Circle,
  CircleCheck,
  CircleDashed,
  Filter,
  Info,
  Loader2,
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
import { cn, plural } from '@/lib/utils'
import { STATUS_LABEL, type FeatureStatus, type GraphEdge, type GraphNode } from '@/lib/types'

/**
 * The dependency canvas, drawn as a top-down tree.
 *
 * Blocking features sit above the features waiting on them, so reading down
 * the page is reading forward in time. Connectors are orthogonal rather than
 * curved: with a shared trunk fanning out to children, a branch can be
 * followed by eye without tracing overlapping arcs.
 *
 * Clicking a feature focuses its chain — everything it blocks, and everything
 * blocking it — and dims the rest. On a graph of any size that is the only way
 * to answer "what is actually in the way of this one".
 */

const NODE_WIDTH = 232
const NODE_HEIGHT = 104
const COLUMN_GAP = 40
const ROW_GAP = 58

export function DependencyCanvas({ projectId }: { projectId: number }) {
  // The provider must sit above anything calling React Flow's hooks.
  return (
    <ReactFlowProvider>
      <Canvas projectId={projectId} />
    </ReactFlowProvider>
  )
}

type NodeData = GraphNode & {
  inCycle: boolean
  dimmed: boolean
  focused: boolean
  childCount: number
  onOpen: () => void
}

function Canvas({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const graph = useDependencyGraph(projectId)
  const createDependency = useCreateDependency(projectId)
  const deleteDependency = useDeleteDependency(projectId)

  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [focusId, setFocusId] = useState<number | null>(null)
  const [connectedOnly, setConnectedOnly] = useState(false)
  const [hideDone, setHideDone] = useState(false)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')

  const allNodes = useMemo(() => graph.data?.nodes ?? [], [graph.data])
  const allEdges = useMemo(() => graph.data?.edges ?? [], [graph.data])

  // Most projects have far more features than dependencies, so an unfiltered
  // canvas is mostly unconnected cards. These two toggles exist to cut that
  // down to what the graph is actually about.
  const visible = useMemo(() => {
    const connected = new Set<number>()
    for (const edge of allEdges) {
      connected.add(edge.parent_id)
      connected.add(edge.child_id)
    }

    const nodes = allNodes.filter((node) => {
      if (connectedOnly && !connected.has(node.id)) return false
      if (hideDone && node.status === 'done') return false
      return true
    })

    const kept = new Set(nodes.map((n) => n.id))
    const edges = allEdges.filter((e) => kept.has(e.parent_id) && kept.has(e.child_id))

    return { nodes, edges, isolated: allNodes.length - connected.size }
  }, [allNodes, allEdges, connectedOnly, hideDone])

  const layout = useMemo(() => buildLayout(visible.nodes, visible.edges), [visible])

  // Which nodes and edges belong to the focused feature's chain.
  const focus = useMemo(
    () => (focusId === null ? null : relatedTo(focusId, visible.edges)),
    [focusId, visible.edges],
  )

  const openFeature = useCallback(
    (featureId: number) => navigate({ name: 'feature', projectId, featureId }),
    [navigate, projectId],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Seed the canvas from the layout. Positions come from the data, so a
  // refetch redraws rather than merging into whatever was on screen.
  useEffect(() => {
    setNodes(
      layout.nodes.map((node) => ({
        ...node,
        data: { ...node.data, onOpen: () => openFeature(node.data.id) },
      })),
    )
    setEdges(layout.edges)
  }, [layout, setNodes, setEdges, openFeature])

  // Focus only changes appearance, so it updates data and style in place
  // rather than rebuilding the layout — otherwise any node you had dragged
  // would snap back every time you clicked something.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const id = Number(node.id)
        const inFocus = focus === null || focus.nodes.has(id)
        return {
          ...node,
          data: { ...node.data, dimmed: !inFocus, focused: focusId === id },
        }
      }),
    )

    setEdges((current) =>
      current.map((edge) => {
        const inFocus = focus === null || focus.edges.has(Number(edge.id))
        const isCycle = edge.data?.inCycle === true
        return {
          ...edge,
          animated: isCycle && inFocus,
          style: edgeStyle(isCycle, !inFocus),
          markerEnd: edgeMarker(isCycle, !inFocus),
        }
      }),
    )
  }, [focus, focusId, setNodes, setEdges])

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return

      setMessage('')
      setWarning('')

      try {
        const created = await createDependency.mutateAsync({
          parent_id: Number(connection.source),
          child_id: Number(connection.target),
        })
        if (created.creates_cycle) {
          setWarning('That dependency closes a loop. The features now block each other.')
        }
      } catch (error) {
        setMessage(error instanceof ApiError ? error.message : 'Could not add that dependency')
      }
    },
    [createDependency],
  )

  async function removeSelected() {
    if (!selectedEdge) return

    setMessage('')
    try {
      await deleteDependency.mutateAsync(selectedEdge.id)
      setSelectedEdge(null)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Could not remove that dependency')
    }
  }

  const cycles = graph.data?.cycles ?? []

  if (graph.isError) {
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

  return (
    <div className="space-y-3">
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

      {cycles.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-xs">
            <p className="font-medium text-ink">
              {plural(cycles.length, 'circular dependency', 'circular dependencies')} found
            </p>
            <p className="mt-0.5 text-muted">
              Features in a loop each wait on the other, so none of them can start. The connectors
              involved are drawn in amber.
            </p>
          </div>
        </div>
      )}

      {message && (
        <Banner tone="danger" onDismiss={() => setMessage('')}>
          {message}
        </Banner>
      )}
      {warning && (
        <Banner tone="warning" onDismiss={() => setWarning('')}>
          {warning}
        </Banner>
      )}

      <div className="relative h-[calc(100vh-215px)] min-h-[460px] overflow-hidden rounded-lg border border-border bg-bg">
        {graph.isLoading ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : visible.nodes.length === 0 ? (
          <EmptyCanvas
            hasFeatures={allNodes.length > 0}
            filtered={connectedOnly || hideDone}
            onClearFilters={() => {
              setConnectedOnly(false)
              setHideDone(false)
            }}
          />
        ) : (
          <>
            {/* The count sits above the tree, as the reference does. */}
            <div className="pointer-events-none absolute left-3 top-3 z-10">
              <div className="rounded-full border border-border bg-surface/90 px-3.5 py-1.5 shadow-card backdrop-blur">
                <p className="whitespace-nowrap text-xs font-semibold text-ink">
                  Total: <span className="text-accent">{visible.nodes.length}</span>{' '}
                  {visible.nodes.length === 1 ? 'feature' : 'features'}
                  {visible.edges.length > 0 && (
                    <span className="ml-2 font-normal text-muted">
                      {plural(visible.edges.length, 'dependency', 'dependencies')}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => {
                const id = Number(node.id)
                setFocusId((current) => (current === id ? null : id))
                setSelectedEdge(null)
              }}
              onEdgeClick={(_, edge) => {
                setSelectedEdge(visible.edges.find((e) => String(e.id) === edge.id) ?? null)
              }}
              onPaneClick={() => {
                setFocusId(null)
                setSelectedEdge(null)
              }}
              nodeTypes={nodeTypes}
              fitView
              // A deep tree cannot be shown whole and stay legible, so the fit
              // stops at a readable zoom and the rest is reached by panning.
              fitViewOptions={{ padding: 0.22, minZoom: 0.62, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} className="opacity-60" />
              <Controls showInteractive={false} position="bottom-right" className="!shadow-none" />
            </ReactFlow>

            <Toolbar
              connectedOnly={connectedOnly}
              hideDone={hideDone}
              isolatedCount={visible.isolated}
              focused={focusId !== null}
              onToggleConnected={() => setConnectedOnly((v) => !v)}
              onToggleDone={() => setHideDone((v) => !v)}
              onClearFocus={() => setFocusId(null)}
            />

            {selectedEdge && (
              <div className="absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-pop">
                <span className="text-xs text-muted">
                  {selectedEdge.in_cycle && (
                    <AlertTriangle className="mr-1.5 inline h-3 w-3 text-warning" />
                  )}
                  Dependency selected
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  className="h-7"
                  loading={deleteDependency.isPending}
                  onClick={removeSelected}
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </Button>
                <button
                  onClick={() => setSelectedEdge(null)}
                  aria-label="Deselect"
                  className="text-faint hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-2xs text-faint">
        <Info className="h-3 w-3" />
        Drag from the dot under one card to the dot above another to add a dependency. A card sits
        below whatever must be finished first. Click a card to follow its chain, or an edge to
        remove it.
      </p>
    </div>
  )
}

// --- The feature card ------------------------------------------------------

const STATUS_ICON: Record<FeatureStatus, typeof Circle> = {
  todo: CircleDashed,
  in_progress: Circle,
  done: CircleCheck,
}

function FeatureNode({ data }: NodeProps<NodeData>) {
  const Icon = STATUS_ICON[data.status] ?? CircleDashed

  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-surface transition-all duration-200',
        data.dimmed ? 'opacity-35' : 'opacity-100',
        data.focused
          ? 'border-accent shadow-pop ring-2 ring-accent/25'
          : data.inCycle
            ? 'border-warning shadow-card'
            : 'border-border shadow-card',
      )}
      style={{ width: NODE_WIDTH }}
    >
      {/* Handles top and bottom, so a drag runs downward in the same direction
          the tree is read. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-faint"
      />

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg',
            data.status === 'done'
              ? 'bg-success-soft text-success'
              : data.status === 'in_progress'
                ? 'bg-warning-soft text-warning'
                : 'bg-raised text-faint',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-ink" title={data.title}>
            {data.title}
          </p>
          <p className="mt-0.5 truncate text-2xs text-muted">
            {STATUS_LABEL[data.status] ?? data.status}
            {data.priority === 'high' && <span className="ml-1 text-danger">· High</span>}
            {data.category && data.category !== 'general' && (
              <span className="ml-1 text-faint">· {data.category}</span>
            )}
          </p>
        </div>

        {data.inCycle && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />}
      </div>

      {/* The divided footer, as in the reference: the card states, the footer
          acts. */}
      <button
        onClick={(event) => {
          event.stopPropagation()
          data.onOpen()
        }}
        className="w-full rounded-b-xl border-t border-border py-1.5 text-2xs font-medium text-accent transition-colors hover:bg-accent-soft"
      >
        Details
      </button>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-accent"
      />

      {/* The badge on the trunk, counting what hangs off this card. */}
      {data.childCount > 0 && (
        <span
          className={cn(
            'absolute -bottom-[30px] left-1/2 z-10 grid h-6 min-w-6 -translate-x-1/2 place-items-center',
            'rounded-full px-1.5 text-2xs font-semibold tabular-nums text-white shadow-sm',
            data.inCycle ? 'bg-warning' : 'bg-accent',
          )}
          title={`Blocks ${plural(data.childCount, 'feature')}`}
        >
          {data.childCount}
        </span>
      )}
    </div>
  )
}

// Declared once, outside the component: a fresh object each render makes React
// Flow warn and remount every node.
const nodeTypes = { feature: FeatureNode }

// --- Layout ----------------------------------------------------------------

function edgeStyle(inCycle: boolean, dimmed: boolean) {
  return {
    stroke: inCycle ? 'hsl(var(--warning))' : 'hsl(var(--accent))',
    strokeWidth: inCycle ? 2 : 1.5,
    opacity: dimmed ? 0.18 : inCycle ? 1 : 0.55,
  }
}

function edgeMarker(inCycle: boolean, dimmed: boolean) {
  return {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: inCycle ? 'hsl(var(--warning))' : 'hsl(var(--accent))',
    strokeWidth: dimmed ? 0.4 : 1,
  }
}

/**
 * Arrange the graph as a tree: one row per depth, ordered so children sit
 * under their parents.
 *
 * Ordering is a few barycentre passes — repeatedly place each node near the
 * average position of its neighbours in the adjacent row. It is not optimal
 * crossing reduction, which is NP-hard, but it settles quickly and turns a
 * tangle into something followable.
 */
function buildLayout(graphNodes: GraphNode[], graphEdges: GraphEdge[]) {
  const cycleNodes = new Set<number>()
  const childCount = new Map<number, number>()
  const parentsOf = new Map<number, number[]>()
  const childrenOf = new Map<number, number[]>()

  for (const edge of graphEdges) {
    if (edge.in_cycle) {
      cycleNodes.add(edge.parent_id)
      cycleNodes.add(edge.child_id)
    }
    childCount.set(edge.parent_id, (childCount.get(edge.parent_id) ?? 0) + 1)
    parentsOf.set(edge.child_id, [...(parentsOf.get(edge.child_id) ?? []), edge.parent_id])
    childrenOf.set(edge.parent_id, [...(childrenOf.get(edge.parent_id) ?? []), edge.child_id])
  }

  const rows = new Map<number, GraphNode[]>()
  for (const node of graphNodes) {
    rows.set(node.depth, [...(rows.get(node.depth) ?? []), node])
  }

  const depths = [...rows.keys()].sort((a, b) => a - b)
  const order = new Map<number, number>()
  for (const depth of depths) {
    rows.get(depth)!.forEach((node, index) => order.set(node.id, index))
  }

  const meanOf = (ids: number[] | undefined, fallback: number) => {
    if (!ids || ids.length === 0) return fallback
    const known = ids.map((id) => order.get(id)).filter((v): v is number => v !== undefined)
    if (known.length === 0) return fallback
    return known.reduce((a, b) => a + b, 0) / known.length
  }

  for (let pass = 0; pass < 4; pass++) {
    // Downward: settle each row against its parents.
    for (const depth of depths) {
      const row = rows.get(depth)!
      row.sort((a, b) => meanOf(parentsOf.get(a.id), order.get(a.id) ?? 0) -
        meanOf(parentsOf.get(b.id), order.get(b.id) ?? 0))
      row.forEach((node, index) => order.set(node.id, index))
    }
    // Upward: settle each row against its children.
    for (const depth of [...depths].reverse()) {
      const row = rows.get(depth)!
      row.sort((a, b) => meanOf(childrenOf.get(a.id), order.get(a.id) ?? 0) -
        meanOf(childrenOf.get(b.id), order.get(b.id) ?? 0))
      row.forEach((node, index) => order.set(node.id, index))
    }
  }

  const nodes: Node<NodeData>[] = []
  for (const depth of depths) {
    const row = rows.get(depth)!
    const rowWidth = row.length * (NODE_WIDTH + COLUMN_GAP)

    row.forEach((node, index) => {
      nodes.push({
        id: String(node.id),
        type: 'feature',
        position: {
          // Centre each row on the same axis, so the tree reads as a column
          // rather than hanging off the left edge.
          x: index * (NODE_WIDTH + COLUMN_GAP) - rowWidth / 2,
          y: depth * (NODE_HEIGHT + ROW_GAP),
        },
        data: {
          ...node,
          inCycle: cycleNodes.has(node.id),
          dimmed: false,
          focused: false,
          childCount: childCount.get(node.id) ?? 0,
          onOpen: () => {},
        },
      })
    })
  }

  const edges: Edge[] = graphEdges.map((edge) => ({
    id: String(edge.id),
    source: String(edge.parent_id),
    target: String(edge.child_id),
    // Stepped connectors with a small radius give the squared-off trunk the
    // reference uses; a curve would blur which branch is which.
    type: 'smoothstep',
    pathOptions: { borderRadius: 12 },
    animated: edge.in_cycle,
    style: edgeStyle(edge.in_cycle, false),
    markerEnd: edgeMarker(edge.in_cycle, false),
    data: { inCycle: edge.in_cycle },
  }))

  return { nodes, edges }
}

/** Everything up and down the chain from one feature, plus the edges between. */
function relatedTo(startId: number, graphEdges: GraphEdge[]) {
  const up = new Map<number, number[]>()
  const down = new Map<number, number[]>()
  for (const edge of graphEdges) {
    down.set(edge.parent_id, [...(down.get(edge.parent_id) ?? []), edge.child_id])
    up.set(edge.child_id, [...(up.get(edge.child_id) ?? []), edge.parent_id])
  }

  const nodes = new Set<number>([startId])

  const walk = (from: number, links: Map<number, number[]>) => {
    const queue = [from]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const next of links.get(current) ?? []) {
        if (!nodes.has(next)) {
          nodes.add(next)
          queue.push(next)
        }
      }
    }
  }

  walk(startId, up)
  walk(startId, down)

  const edges = new Set<number>()
  for (const edge of graphEdges) {
    if (nodes.has(edge.parent_id) && nodes.has(edge.child_id)) edges.add(edge.id)
  }

  return { nodes, edges }
}

// --- Chrome ----------------------------------------------------------------

function Toolbar({
  connectedOnly,
  hideDone,
  isolatedCount,
  focused,
  onToggleConnected,
  onToggleDone,
  onClearFocus,
}: {
  connectedOnly: boolean
  hideDone: boolean
  isolatedCount: number
  focused: boolean
  onToggleConnected: () => void
  onToggleDone: () => void
  onClearFocus: () => void
}) {
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[hsl(224_24%_10%)] p-1 shadow-pop">
      <ToolbarButton active={!connectedOnly} onClick={onToggleConnected}>
        All features
      </ToolbarButton>
      <ToolbarButton active={connectedOnly} onClick={onToggleConnected}>
        Connected only
        {isolatedCount > 0 && <span className="ml-1 opacity-60">−{isolatedCount}</span>}
      </ToolbarButton>

      <span className="mx-1 h-4 w-px bg-white/15" />

      <button
        onClick={onToggleDone}
        aria-pressed={hideDone}
        className={cn(
          'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors',
          hideDone ? 'bg-accent text-accent-ink' : 'text-white/70 hover:bg-white/10 hover:text-white',
        )}
      >
        <Filter className="h-3 w-3" />
        Hide done
      </button>

      {focused && (
        <>
          <span className="mx-1 h-4 w-px bg-white/15" />
          <button
            onClick={onClearFocus}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3 w-3" />
            Clear focus
          </button>
        </>
      )}
    </div>
  )
}

function ToolbarButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs transition-colors',
        active ? 'bg-white/15 font-medium text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </button>
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
  hasFeatures,
  filtered,
  onClearFilters,
}: {
  hasFeatures: boolean
  filtered: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-ink">
          {filtered ? 'Nothing matches these filters' : 'Nothing to draw yet'}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
          {filtered
            ? 'Every feature was filtered out of the view.'
            : hasFeatures
              ? 'This project has features but no dependencies between them yet. Drag from the dot under one card to another to connect them.'
              : 'This project has no features, so there is nothing to depend on anything.'}
        </p>
        {filtered && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}
