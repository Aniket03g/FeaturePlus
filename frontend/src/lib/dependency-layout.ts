import type { GraphEdge, GraphNode } from '@/lib/types'

/**
 * Layout for the dependency canvas.
 *
 * Two relationships are drawn at once and they are not the same thing:
 *
 *   part of    a feature nested inside another (parent_id), drawn as a
 *              boundary around its children
 *   requires   a dependency, drawn as an arrow from the blocker down to the
 *              feature waiting on it
 *
 * Nothing here positions anything. The canvas is laid out by the browser —
 * tiers are rows, a branch is a nested box — because that is what makes
 * expanding a branch push its siblings aside instead of covering them. The
 * arrows are then drawn over the measured result, which is why routeEdges
 * takes rectangles rather than producing them.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Tree {
  byId: Map<number, GraphNode>
  childrenOf: Map<number, number[]>
  parentOf: Map<number, number>
  levelOf: Map<number, number>
  roots: number[]
  maxLevel: number
}

/** Build the part-of tree. A parent that is missing is treated as no parent. */
export function buildTree(nodes: GraphNode[]): Tree {
  const byId = new Map<number, GraphNode>()
  for (const node of nodes) byId.set(node.id, node)

  const childrenOf = new Map<number, number[]>()
  const parentOf = new Map<number, number>()
  const roots: number[] = []

  for (const node of nodes) {
    const parent = node.parent_id
    // A parent that is missing, or a feature that is somehow its own parent,
    // would otherwise nest a card inside a boundary that is never drawn.
    if (parent != null && parent !== node.id && byId.has(parent)) {
      parentOf.set(node.id, parent)
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node.id])
    } else {
      roots.push(node.id)
    }
  }

  // Depth in the part-of tree: the L0 / L1 / L2 the DEPTH control steps
  // through. Walking up rather than down keeps a cycle in the parent links
  // from recursing forever.
  const levelOf = new Map<number, number>()
  let maxLevel = 0
  for (const node of nodes) {
    let level = 0
    let current = node.id
    const seen = new Set<number>([current])
    while (parentOf.has(current)) {
      current = parentOf.get(current)!
      if (seen.has(current)) break
      seen.add(current)
      level += 1
    }
    levelOf.set(node.id, level)
    if (level > maxLevel) maxLevel = level
  }

  return { byId, childrenOf, parentOf, levelOf, roots, maxLevel }
}

/** The features actually on the canvas: roots, plus the children of anything open. */
export function visibleIds(tree: Tree, expanded: Set<number>): Set<number> {
  const visible = new Set<number>()

  const walk = (ids: number[]) => {
    for (const id of ids) {
      visible.add(id)
      if (expanded.has(id)) walk(tree.childrenOf.get(id) ?? [])
    }
  }

  walk(tree.roots)
  return visible
}

/** The nearest ancestor that is on the canvas — the node itself, usually. */
function nearestVisible(tree: Tree, id: number, visible: Set<number>): number | null {
  let current: number | undefined = id
  const seen = new Set<number>()
  while (current !== undefined && !seen.has(current)) {
    if (visible.has(current)) return current
    seen.add(current)
    current = tree.parentOf.get(current)
  }
  return null
}

export interface LiftedEdge {
  /** The dependency ids this drawn arrow stands for; more than one when collapsed. */
  ids: number[]
  from: number
  to: number
  /** The two ends sit in different branches, so the arrow crosses a boundary. */
  crossing: boolean
  inCycle: boolean
}

/**
 * Collapse the dependencies down to the arrows worth drawing.
 *
 * A dependency on something inside a closed branch is redrawn against the
 * branch itself, so closing a branch never silently loses an edge. Several
 * dependencies can end up as the same arrow, and an arrow from a branch to
 * itself is dropped — that one is internal and reappears when it is opened.
 */
export function liftEdges(tree: Tree, edges: GraphEdge[], visible: Set<number>): LiftedEdge[] {
  const merged = new Map<string, LiftedEdge>()

  for (const edge of edges) {
    const from = nearestVisible(tree, edge.parent_id, visible)
    const to = nearestVisible(tree, edge.child_id, visible)
    if (from === null || to === null || from === to) continue

    const key = `${from}>${to}`
    const existing = merged.get(key)
    if (existing) {
      existing.ids.push(edge.id)
      existing.inCycle = existing.inCycle || edge.in_cycle
      continue
    }

    merged.set(key, {
      ids: [edge.id],
      from,
      to,
      crossing: tree.parentOf.get(from) !== tree.parentOf.get(to),
      inCycle: edge.in_cycle,
    })
  }

  return [...merged.values()]
}

/** The ancestor of `id` that is a direct child of `container`, if there is one. */
function within(tree: Tree, container: number | null, id: number): number | null {
  let current: number | undefined = id
  const seen = new Set<number>()
  while (current !== undefined && !seen.has(current)) {
    const parent = tree.parentOf.get(current)
    if ((parent ?? null) === container) return current
    seen.add(current)
    current = parent
  }
  return null
}

export interface Tiers {
  /** One row per tier, top to bottom: everything here waits on the row above. */
  rows: number[][]
  /** Children with no dependency to or from a sibling. */
  independent: number[]
}

/**
 * Sort one container's children into rows.
 *
 * A child sits one row below the last thing it waits on, so reading down a
 * container is reading forward in time. Dependencies that reach outside the
 * container still count: a dependency on something deep inside a sibling
 * branch orders this container against that whole branch.
 */
export function tierise(
  tree: Tree,
  container: number | null,
  children: number[],
  edges: LiftedEdge[],
): Tiers {
  const kept = new Set(children)
  const parents = new Map<number, number[]>()
  const touched = new Set<number>()

  for (const edge of edges) {
    const from = within(tree, container, edge.from)
    const to = within(tree, container, edge.to)
    if (from === null || to === null || from === to) continue
    if (!kept.has(from) || !kept.has(to)) continue

    parents.set(to, [...(parents.get(to) ?? []), from])
    touched.add(from)
    touched.add(to)
  }

  // Longest path in. The visited set makes a dependency loop settle on a
  // finite answer rather than recursing forever; the loop itself is reported
  // separately, so it does not have to be resolved here.
  const depth = new Map<number, number>()
  const measure = (id: number, visiting: Set<number>): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0

    visiting.add(id)
    let best = 0
    for (const parent of parents.get(id) ?? []) {
      best = Math.max(best, measure(parent, visiting) + 1)
    }
    visiting.delete(id)

    depth.set(id, best)
    return best
  }

  const rows: number[][] = []
  const independent: number[] = []

  for (const id of children) {
    if (!touched.has(id)) {
      independent.push(id)
      continue
    }
    const tier = measure(id, new Set())
    while (rows.length <= tier) rows.push([])
    rows[tier].push(id)
  }

  return { rows, independent }
}

/**
 * Everything up and down the chain from one feature.
 *
 * Up is what it waits on, down is what waits on it, both followed all the way
 * out. The branches those features sit in come too, so a boundary does not
 * fade out from under a card that is still lit.
 */
export function chainFrom(tree: Tree, start: number, edges: LiftedEdge[]) {
  const up = new Map<number, number[]>()
  const down = new Map<number, number[]>()
  for (const edge of edges) {
    down.set(edge.from, [...(down.get(edge.from) ?? []), edge.to])
    up.set(edge.to, [...(up.get(edge.to) ?? []), edge.from])
  }

  const nodes = new Set<number>([start])
  const walk = (links: Map<number, number[]>) => {
    const queue = [start]
    while (queue.length > 0) {
      for (const next of links.get(queue.shift()!) ?? []) {
        if (nodes.has(next)) continue
        nodes.add(next)
        queue.push(next)
      }
    }
  }
  walk(up)
  walk(down)

  for (const id of [...nodes]) {
    let parent = tree.parentOf.get(id)
    while (parent !== undefined && !nodes.has(parent)) {
      nodes.add(parent)
      parent = tree.parentOf.get(parent)
    }
  }

  const keys = new Set<string>()
  for (const edge of edges) {
    if (nodes.has(edge.from) && nodes.has(edge.to)) keys.add(`${edge.from}>${edge.to}`)
  }

  return { nodes, keys }
}

// --- Arrows ----------------------------------------------------------------

export interface RoutedEdge extends LiftedEdge {
  d: string
}

const round = (v: number) => Math.round(v * 10) / 10

/**
 * Draw the arrows over the measured layout.
 *
 * Every arrow leaves the bottom of its blocker and enters the top of what it
 * blocks. Three things keep a dense map readable: arrows out of one card fan
 * across its bottom edge instead of stacking on one point, arrows into the
 * same row take separate horizontal lanes, and an arrow that would cut
 * through an unrelated card is re-routed through the nearest free column.
 *
 * An arrow that cannot run downwards — a dependency loop, or two branches
 * that ended up side by side — is drawn around the right instead, so it is
 * still visible rather than quietly dropped.
 */
export function routeEdges(
  tree: Tree,
  edges: LiftedEdge[],
  pos: Map<number, Rect>,
  canvasWidth: number,
): RoutedEdge[] {
  type Candidate = {
    edge: LiftedEdge
    a: Rect
    b: Rect
    x1: number
    x2: number
    mid: number
    lane: number
  }

  const forward: Candidate[] = []
  const sideways: LiftedEdge[] = []

  for (const edge of edges) {
    const a = pos.get(edge.from)
    const b = pos.get(edge.to)
    if (!a || !b) continue

    if (b.y <= a.y + a.h + 6) {
      sideways.push(edge)
      continue
    }
    forward.push({ edge, a, b, x1: a.x + a.w / 2, x2: b.x + b.w / 2, mid: 0, lane: 0 })
  }

  // Fan out along the blocker's bottom edge, and in along the top edge of
  // whatever is waiting, so two arrows never leave or land on the same point.
  const spread = (
    groups: Map<number, Candidate[]>,
    rectOf: (c: Candidate) => Rect,
    sortBy: (c: Candidate) => number,
    assign: (c: Candidate, x: number) => void,
    gap: number,
  ) => {
    for (const group of groups.values()) {
      group.sort((p, q) => sortBy(p) - sortBy(q))
      const rect = rectOf(group[0])
      const span = Math.min(rect.w - 26, (group.length - 1) * gap)
      group.forEach((c, i) => {
        const offset = group.length === 1 ? 0 : -span / 2 + (span * i) / (group.length - 1)
        assign(c, rect.x + rect.w / 2 + offset)
      })
    }
  }

  const bySource = new Map<number, Candidate[]>()
  const byTarget = new Map<number, Candidate[]>()
  for (const c of forward) {
    bySource.set(c.edge.from, [...(bySource.get(c.edge.from) ?? []), c])
    byTarget.set(c.edge.to, [...(byTarget.get(c.edge.to) ?? []), c])
  }

  spread(bySource, (c) => c.a, (c) => c.b.x + c.b.w / 2, (c, x) => { c.x1 = x }, 26)
  spread(byTarget, (c) => c.b, (c) => c.x1, (c, x) => { c.x2 = x }, 24)

  // Arrows landing in the same row share the gap above it, and the sideways
  // part of each one needs a line to travel along.
  //
  // Giving every arrow its own line stacks twenty of them in a gap that fits
  // six, which is what makes a large map unreadable. Two arrows whose
  // sideways runs do not overlap can share a line perfectly well, so lines
  // are handed out by overlap rather than by count — a dense band settles on
  // a handful instead of one per arrow. Widest runs go furthest from the row
  // they land in, so they clear the cards they pass over.
  const LANE_PAD = 14

  const rows = new Map<number, Candidate[]>()
  for (const c of forward) {
    const key = Math.round(c.b.y / 24)
    rows.set(key, [...(rows.get(key) ?? []), c])
  }

  for (const group of rows.values()) {
    group.sort((p, q) => Math.abs(q.x2 - q.x1) - Math.abs(p.x2 - p.x1))

    const lanes: { min: number; max: number }[][] = []

    for (const c of group) {
      if (Math.abs(c.x2 - c.x1) < 2) continue

      const span = {
        min: Math.min(c.x1, c.x2) - LANE_PAD,
        max: Math.max(c.x1, c.x2) + LANE_PAD,
      }

      let lane = lanes.findIndex((taken) =>
        taken.every((other) => span.max < other.min || span.min > other.max),
      )
      if (lane === -1) {
        lane = lanes.length
        lanes.push([])
      }
      lanes[lane].push(span)
      c.lane = lane
    }

    // Spread the lines over whatever vertical room the gap actually has,
    // rather than a fixed step that runs out of space and starts overlapping.
    for (const c of group) {
      const top = c.a.y + c.a.h
      const bottom = c.b.y
      const base = bottom - Math.min((bottom - top) * 0.5, 30)

      if (Math.abs(c.x2 - c.x1) < 2) {
        c.mid = base
        continue
      }

      const room = Math.max(0, base - top - 10)
      const step = lanes.length > 1 ? Math.min(11, room / (lanes.length - 1)) : 0
      c.mid = Math.max(top + 10, base - c.lane * step)
    }
  }

  const ids = [...pos.keys()]

  forward.sort((p, q) => q.b.y - q.a.y - (p.b.y - p.a.y))

  // Vertical corridors already in use, so two long arrows travelling the same
  // stretch do not end up drawn on top of each other.
  const corridors: { x: number; y0: number; y1: number }[] = []
  const corridorFree = (x: number, y0: number, y1: number) =>
    !corridors.some((c) => Math.abs(c.x - x) < 12 && y1 > c.y0 && y0 < c.y1)

  const family = (id: number) => {
    const out = new Set<number>()
    let current: number | undefined = id
    while (current !== undefined && !out.has(current)) {
      out.add(current)
      current = tree.parentOf.get(current)
    }
    const down = (from: number) => {
      for (const child of tree.childrenOf.get(from) ?? []) {
        if (out.has(child)) continue
        out.add(child)
        down(child)
      }
    }
    down(id)
    return out
  }

  const hits = (p: [number, number], q: [number, number], rect: Rect) => {
    const pad = 5
    return (
      Math.min(p[0], q[0]) < rect.x + rect.w + pad &&
      Math.max(p[0], q[0]) > rect.x - pad &&
      Math.min(p[1], q[1]) < rect.y + rect.h + pad &&
      Math.max(p[1], q[1]) > rect.y - pad
    )
  }

  // Checked against the cards an arrow could actually reach — the ones in the
  // band of rows it crosses — rather than every card on the map. On a large
  // map that is the difference between a redraw you notice and one you do not.
  const blocked = (points: [number, number][], obstacles: Rect[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      for (const rect of obstacles) {
        if (hits(points[i], points[i + 1], rect)) return true
      }
    }
    return false
  }

  /** How many free columns to try before accepting the straight route. */
  const COLUMN_TRIES = 24

  const corner = (points: [number, number][], radius: number) => {
    let d = `M${round(points[0][0])} ${round(points[0][1])}`
    for (let i = 1; i < points.length - 1; i++) {
      const [px, py] = points[i - 1]
      const [qx, qy] = points[i]
      const [sx, sy] = points[i + 1]
      const inLen = Math.max(1, Math.hypot(qx - px, qy - py))
      const outLen = Math.max(1, Math.hypot(sx - qx, sy - qy))
      const r = Math.min(radius, inLen / 2, outLen / 2)
      const a = [qx + ((px - qx) / inLen) * r, qy + ((py - qy) / inLen) * r]
      const b = [qx + ((sx - qx) / outLen) * r, qy + ((sy - qy) / outLen) * r]
      d += ` L${round(a[0])} ${round(a[1])} Q${round(qx)} ${round(qy)} ${round(b[0])} ${round(b[1])}`
    }
    const end = points[points.length - 1]
    return `${d} L${round(end[0])} ${round(end[1])}`
  }

  const routed: RoutedEdge[] = []

  for (const c of forward) {
    const top = c.a.y + c.a.h
    const bottom = c.b.y

    const skip = new Set<number>()
    for (const id of family(c.edge.from)) skip.add(id)
    for (const id of family(c.edge.to)) skip.add(id)

    // The cards this arrow could run into, and the columns either side of
    // them, worked out once rather than on every route attempted.
    const obstacles: Rect[] = []
    const columns: number[] = [c.x1, c.x2, 22, canvasWidth - 22]
    for (const id of ids) {
      if (skip.has(id)) continue
      const rect = pos.get(id)!
      if (rect.y + rect.h < top - 8 || rect.y > bottom + 8) continue
      obstacles.push(rect)
      columns.push(rect.x - 18, rect.x + rect.w + 18)
    }

    let points: [number, number][] =
      Math.abs(c.x1 - c.x2) < 2
        ? [[c.x1, top], [c.x2, bottom]]
        : [[c.x1, top], [c.x1, c.mid], [c.x2, c.mid], [c.x2, bottom]]

    if (blocked(points, obstacles)) {
      // Try free vertical corridors, nearest to the straight line first, and
      // give up after a bounded number rather than searching the whole width.
      const centre = (c.x1 + c.x2) / 2
      columns.sort((p, q) => Math.abs(p - centre) - Math.abs(q - centre))
      const tries = columns.slice(0, COLUMN_TRIES)

      outer: for (const yA of [top + 12, top + 7, top + 24, top + 38]) {
        for (const yB of [bottom - 14, bottom - 8, bottom - 28]) {
          if (yB <= yA + 6) continue
          for (const x of tries) {
            const alt: [number, number][] = [
              [c.x1, top], [c.x1, yA], [x, yA], [x, yB], [c.x2, yB], [c.x2, bottom],
            ]
            if (!blocked(alt, obstacles) && corridorFree(x, yA, yB)) {
              points = alt
              corridors.push({ x, y0: yA, y1: yB })
              break outer
            }
          }
        }
      }
    }

    routed.push({ ...c.edge, d: corner(points, 9) })
  }

  // Anything that does not run downwards goes around the right-hand side.
  for (const edge of sideways) {
    const a = pos.get(edge.from)
    const b = pos.get(edge.to)
    if (!a || !b) continue

    const lane = Math.max(a.x + a.w, b.x + b.w) + 26
    const points: [number, number][] = [
      [a.x + a.w, a.y + a.h / 2],
      [lane, a.y + a.h / 2],
      [lane, b.y + b.h / 2],
      [b.x + b.w, b.y + b.h / 2],
    ]
    routed.push({ ...edge, d: corner(points, 9) })
  }

  return routed
}
