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
import { AlertTriangle, ArrowLeft, Info, Loader2, Trash2, X } from 'lucide-react'
import {
  useCreateDependency,
  useDeleteDependency,
  useDependencyGraph,
  useProject,
} from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { cn, plural } from '@/lib/utils'
import { STATUS_LABEL, type GraphEdge, type GraphNode } from '@/lib/types'

/**
 * The dependency canvas.
 *
 * An edge points from the feature that must be finished to the one waiting on
 * it, so arrows read as "unblocks". Columns come from the depth the server
 * already computed, which keeps the layout stable between loads rather than
 * rearranging itself every time a physics simulation settles differently.
 */

const NODE_WIDTH = 210
const NODE_HEIGHT = 74
const COLUMN_GAP = 110
const ROW_GAP = 26

export function DependencyCanvas({ projectId }: { projectId: number }) {
  return (
    // The provider must sit above anything calling React Flow's hooks.
    <ReactFlowProvider>
      <Canvas projectId={projectId} />
    </ReactFlowProvider>
  )
}

function Canvas({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const graph = useDependencyGraph(projectId)
  const createDependency = useCreateDependency(projectId)
  const deleteDependency = useDeleteDependency(projectId)

  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')

  const layout = useMemo(
    () => buildLayout(graph.data?.nodes ?? [], graph.data?.edges ?? []),
    [graph.data],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges)

  // Re-seed the canvas whenever the graph is refetched. Positions are derived
  // from the data, so a change upstream should redraw rather than merge.
  useEffect(() => {
    setNodes(layout.nodes)
    setEdges(layout.edges)
  }, [layout, setNodes, setEdges])

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

        // Closing a loop is allowed but worth saying out loud.
        if (created.creates_cycle) {
          setWarning('That dependency closes a loop. The features now block each other.')
        }
      } catch (error) {
        setMessage(
          error instanceof ApiError ? error.message : 'Could not add that dependency',
        )
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
      setMessage(
        error instanceof ApiError ? error.message : 'Could not remove that dependency',
      )
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

        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          {graph.isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <span>{plural(graph.data?.nodes.length ?? 0, 'feature')}</span>
              <span className="text-faint">·</span>
              <span>{plural(graph.data?.edges.length ?? 0, 'dependency', 'dependencies')}</span>
            </>
          )}
        </div>
      </div>

      {cycles.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-xs">
            <p className="font-medium text-ink">
              {plural(cycles.length, 'circular dependency', 'circular dependencies')} found
            </p>
            <p className="mt-0.5 text-muted">
              Features in a loop each wait on the other, so none of them can start. The edges
              involved are drawn in amber.
            </p>
          </div>
        </div>
      )}

      {message && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          <span className="flex-1">{message}</span>
          <button onClick={() => setMessage('')} aria-label="Dismiss">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {warning && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-ink">
          <span className="flex-1">{warning}</span>
          <button onClick={() => setWarning('')} aria-label="Dismiss">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="relative h-[calc(100vh-230px)] min-h-[420px] overflow-hidden rounded-lg border border-border bg-surface">
        {graph.isLoading ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : nodes.length === 0 ? (
          <EmptyCanvas />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={(_, edge) => {
              const found = graph.data?.edges.find((e) => String(e.id) === edge.id)
              setSelectedEdge(found ?? null)
            }}
            onPaneClick={() => setSelectedEdge(null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="opacity-40" />
            <Controls showInteractive={false} className="!shadow-none" />
          </ReactFlow>
        )}

        {selectedEdge && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 shadow-pop">
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
      </div>

      <p className="flex items-center gap-1.5 text-2xs text-faint">
        <Info className="h-3 w-3" />
        Drag from a node's right edge to another node's left edge to add a dependency. An arrow
        points from the feature that must be finished to the one waiting on it. Click an edge to
        remove it.
      </p>
    </div>
  )
}

/** The card drawn for each feature. */
function FeatureNode({ data }: NodeProps<GraphNode & { inCycle: boolean }>) {
  const tone =
    data.status === 'done'
      ? 'border-success/50'
      : data.status === 'in_progress'
        ? 'border-warning/50'
        : 'border-border'

  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-surface px-3 py-2 shadow-card transition-shadow',
        'hover:shadow-pop',
        data.inCycle ? 'border-warning' : tone,
      )}
      style={{ width: NODE_WIDTH }}
    >
      {/* Targets on the left, sources on the right, so a drag reads left to
          right in the same direction as the arrows. */}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-faint" />

      <p className="truncate text-xs font-medium text-ink" title={data.title}>
        {data.title}
      </p>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            data.status === 'done'
              ? 'bg-success'
              : data.status === 'in_progress'
                ? 'bg-warning'
                : 'bg-faint',
          )}
        />
        <span className="text-2xs text-muted">{STATUS_LABEL[data.status] ?? data.status}</span>
        {data.priority === 'high' && <Badge tone="danger">high</Badge>}
        {data.inCycle && <AlertTriangle className="ml-auto h-3 w-3 text-warning" />}
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-accent" />
    </div>
  )
}

// Declared outside the component so React Flow does not see a new object on
// every render, which it warns about and which forces a remount.
const nodeTypes = { feature: FeatureNode }

/**
 * Place nodes in columns by depth, and rows within a column.
 *
 * Using the server's depth keeps the picture stable: the same graph lays out
 * the same way every time, so returning to the canvas does not present a
 * rearranged version of what you were just looking at.
 */
function buildLayout(graphNodes: GraphNode[], graphEdges: GraphEdge[]) {
  const cycleNodes = new Set<number>()
  for (const edge of graphEdges) {
    if (edge.in_cycle) {
      cycleNodes.add(edge.parent_id)
      cycleNodes.add(edge.child_id)
    }
  }

  const columns = new Map<number, GraphNode[]>()
  for (const node of graphNodes) {
    const column = columns.get(node.depth) ?? []
    column.push(node)
    columns.set(node.depth, column)
  }

  const nodes: Node[] = []
  for (const [depth, column] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    // Centre each column vertically against the tallest one, so the graph
    // reads as a band rather than hanging off the top edge.
    const height = column.length * (NODE_HEIGHT + ROW_GAP)
    column.forEach((node, index) => {
      nodes.push({
        id: String(node.id),
        type: 'feature',
        position: {
          x: depth * (NODE_WIDTH + COLUMN_GAP),
          y: index * (NODE_HEIGHT + ROW_GAP) - height / 2,
        },
        data: { ...node, inCycle: cycleNodes.has(node.id) },
      })
    })
  }

  const edges: Edge[] = graphEdges.map((edge) => ({
    id: String(edge.id),
    source: String(edge.parent_id),
    target: String(edge.child_id),
    animated: edge.in_cycle,
    style: {
      stroke: edge.in_cycle ? 'hsl(var(--warning))' : 'hsl(var(--border))',
      strokeWidth: edge.in_cycle ? 2 : 1.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: edge.in_cycle ? 'hsl(var(--warning))' : 'hsl(var(--faint))',
    },
    label: edge.description || undefined,
    labelStyle: { fontSize: 10, fill: 'hsl(var(--muted))' },
  }))

  return { nodes, edges }
}

function EmptyCanvas() {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-ink">Nothing to draw yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
          This project has no features, so there is nothing to depend on anything. Add a few
          features first, then come back to connect them.
        </p>
      </div>
    </div>
  )
}
