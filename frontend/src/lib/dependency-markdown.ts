import type { DependencyGraph, FeatureStatus, GraphEdge, GraphNode } from '@/lib/types'

/**
 * A map written by hand, so a shape can be tried without creating a project.
 *
 * The canvas draws two different relationships, and the format keeps them
 * apart the same way the picture does:
 *
 *   indentation   part of  — this feature is inside that one
 *   needs:        requires — this cannot start until those are finished
 *
 * Names are how features refer to each other, so a dependency can reach into
 * another branch by naming something there. The result is the same shape the
 * API returns, and it goes through the same renderer — nothing downstream
 * knows which source it came from.
 *
 * Headings and anything that is not a bullet are ignored, so a document can
 * still be titled and annotated.
 *
 * A bullet may end in a hidden `<!-- fp:KEY -->`, which a downloaded version
 * writes so an edited file can be matched back feature by feature. It is
 * taken off the name and handed back in `refs`.
 */

export const MARKDOWN_EXAMPLE = `# Store

- Platform [in progress]
  - Accounts [done]
  - Data Store [done] > needs: Accounts
  - Background Jobs > needs: Data Store

- Catalogue > needs: Platform
  - Listings [done] > needs: Data Store
  - Search [in progress] > needs: Listings
  - Pricing > needs: Listings
  - Tagging

- Checkout > needs: Catalogue
  - Cart > needs: Accounts
  - Payment > needs: Cart, Pricing
    - Card payment
    - Wallet
    - Refunds > needs: Card payment, Wallet
  - Receipts > needs: Payment

- Reporting > needs: Checkout

- Theming
`

export interface ParsedMarkdown {
  graph: DependencyGraph
  /** Lines that could not be used, said plainly enough to fix. */
  problems: string[]
  /** The hidden key each node's bullet carried, by node id. */
  refs: Map<number, string>
}

const STATUSES: Record<string, FeatureStatus> = {
  todo: 'todo',
  'to do': 'todo',
  'not started': 'todo',
  doing: 'in_progress',
  wip: 'in_progress',
  'in progress': 'in_progress',
  in_progress: 'in_progress',
  done: 'done',
  shipped: 'done',
}

const PRIORITIES = new Set(['low', 'medium', 'high'])

const BULLET = /^(\s*)[-*+]\s+(.*)$/
const NEEDS = /^\s*(?:>\s*)?(?:needs|depends on|blocked by)\s*:\s*(.*)$/i
const REF = /<!--\s*fp:([\w-]{1,64})\s*-->/

/** Split a trailing "needs: a, b" off a bullet, whichever separator was used. */
function splitNeeds(text: string): { title: string; needs: string } {
  const marker = text.search(/(?:^|\s)(?:>\s*)?(?:needs|depends on|blocked by)\s*:/i)
  if (marker === -1) return { title: text.trim(), needs: '' }

  const rest = text.slice(marker)
  const colon = rest.indexOf(':')
  return { title: text.slice(0, marker).trim(), needs: rest.slice(colon + 1) }
}

/** Pull `[done]` / `[high]` tags off a title, leaving the name behind. */
function splitTags(text: string) {
  let status: FeatureStatus = 'todo'
  let priority = 'medium'

  const title = text
    .replace(/\[([^\]]+)\]/g, (_, raw: string) => {
      const tag = raw.trim().toLowerCase()
      if (STATUSES[tag]) status = STATUSES[tag]
      else if (PRIORITIES.has(tag)) priority = tag
      return ''
    })
    .replace(/`/g, '')
    .trim()

  return { title, status, priority }
}

const names = (list: string) =>
  list
    .split(/[,;]/)
    .map((n) => n.trim().replace(/^[-*]\s*/, '').replace(/`/g, ''))
    .filter((n) => n && n.toLowerCase() !== 'none')

export function parseDependencyMarkdown(source: string): ParsedMarkdown {
  const problems: string[] = []
  const nodes: GraphNode[] = []
  const byName = new Map<string, GraphNode>()
  const wants: { from: number; names: string[]; line: number }[] = []
  const refs = new Map<number, string>()

  // Each open bullet and how far it was indented, so a deeper bullet can find
  // the one it belongs to whatever width the file indents by.
  const open: { indent: number; id: number }[] = []
  let last: GraphNode | null = null
  let nextId = 1

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const bullet = BULLET.exec(raw)

    if (!bullet) {
      // A dependency may also sit on its own line under the bullet it belongs
      // to, which reads better when there are several.
      const trailing = NEEDS.exec(raw)
      if (trailing && last) wants.push({ from: last.id, names: names(trailing[1]), line })
      return
    }

    const indent = bullet[1].replace(/\t/g, '  ').length
    const ref = REF.exec(bullet[2])?.[1]
    const { title: withTags, needs } = splitNeeds(bullet[2].replace(REF, ''))
    const { title, status, priority } = splitTags(withTags)

    if (!title) {
      problems.push(`Line ${line}: a bullet with no feature name`)
      return
    }
    if (byName.has(title.toLowerCase())) {
      problems.push(`Line ${line}: "${title}" appears twice — names have to be unique`)
      return
    }

    while (open.length > 0 && indent <= open[open.length - 1].indent) open.pop()

    const node: GraphNode = {
      id: nextId++,
      title,
      status,
      priority: priority as GraphNode['priority'],
      category: 'general',
      tags: [],
      depth: 0,
      parent_id: open.length > 0 ? open[open.length - 1].id : null,
    }

    nodes.push(node)
    if (ref) refs.set(node.id, ref)
    byName.set(title.toLowerCase(), node)
    open.push({ indent, id: node.id })
    last = node

    if (needs.trim()) wants.push({ from: node.id, names: names(needs), line })
  })

  // Dependencies are resolved once every name is known, so a feature can name
  // something defined further down the file.
  const edges: GraphEdge[] = []
  let edgeId = 1

  for (const want of wants) {
    for (const name of want.names) {
      const blocker = byName.get(name.toLowerCase())
      if (!blocker) {
        const from = nodes.find((n) => n.id === want.from)?.title ?? 'A feature'
        const guess = closestName(name, [...byName.values()].map((n) => n.title))
        problems.push(
          `Line ${want.line}: "${from}" needs "${name}", but there’s no feature called that.` +
            (guess ? ` Did you mean “${guess}”?` : ''),
        )
        continue
      }
      if (blocker.id === want.from) {
        problems.push(`Line ${want.line}: "${name}" cannot wait on itself`)
        continue
      }
      edges.push({
        id: edgeId++,
        parent_id: blocker.id,
        child_id: want.from,
        in_cycle: false,
      })
    }
  }

  const cycles = markCycles(nodes, edges)

  return {
    graph: { project_id: 0, nodes, edges, cycles },
    problems,
    refs,
  }
}

/**
 * The name a mistyped one most likely meant: the closest by edit distance,
 * ignoring case, if it is close enough to be a typo rather than a different
 * feature: at most two edits, or a quarter of the name for long ones.
 */
export function closestName(name: string, candidates: string[]): string | null {
  const target = name.toLowerCase()
  let best: string | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase())
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  const allowed = Math.max(2, Math.floor(target.length / 4))
  return best !== null && bestDistance > 0 && bestDistance <= allowed ? best : null
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * Find the dependencies that form a loop, and mark them.
 *
 * An edge is part of a loop when its target can reach its source again. That
 * is a reachability test per edge rather than a proper strongly-connected
 * components pass — slower in theory, but a hand-written map is small, and
 * this reports exactly the edges to draw differently.
 */
function markCycles(nodes: GraphNode[], edges: GraphEdge[]) {
  const out = new Map<number, number[]>()
  for (const edge of edges) {
    out.set(edge.parent_id, [...(out.get(edge.parent_id) ?? []), edge.child_id])
  }

  const reaches = (from: number, target: number) => {
    const seen = new Set<number>([from])
    const queue = [from]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === target) return true
      for (const next of out.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    return false
  }

  const looped: GraphEdge[] = []
  for (const edge of edges) {
    if (!reaches(edge.child_id, edge.parent_id)) continue
    edge.in_cycle = true
    looped.push(edge)
  }

  if (looped.length === 0) return []

  const ids = new Set<number>()
  for (const edge of looped) {
    ids.add(edge.parent_id)
    ids.add(edge.child_id)
  }

  void nodes
  return [{ node_ids: [...ids], edge_ids: looped.map((e) => e.id) }]
}
