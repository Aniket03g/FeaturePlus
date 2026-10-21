import type { FeatureVersionDetail } from '@/lib/queries'
import { STATUS_LABEL, type FeatureStatus } from '@/lib/types'

/**
 * Two feature lists drawn as one tree, with every difference marked where it
 * happened.
 *
 * The tree follows the newer list ("to"). A feature only the older list has
 * is shown where it used to sit, as removed. A feature that moved is shown at
 * its new place, and a faded "was here" row stands at its old one. Features
 * are matched by key, so a renamed feature is the same feature.
 */

type List = FeatureVersionDetail['snapshot']
type Row = List['features'][number]

export type DiffKind = 'added' | 'removed' | 'renamed' | 'moved' | 'needs' | 'details'

export interface DetailChange {
  label: string
  from: string
  to: string
}

export interface DiffNode {
  key: string
  title: string
  /** Set when renamed: the name it had. */
  oldTitle?: string
  /** same, changed, added, removed, or ghost: the faded row where a moved feature used to be. */
  state: 'same' | 'changed' | 'added' | 'removed' | 'ghost'
  kinds: DiffKind[]
  /** For a moved feature, where it came from; for a ghost row, where it went. Paths of names. */
  movedFrom?: string
  movedTo?: string
  needsAdded: string[]
  needsRemoved: string[]
  /** A new feature's dependencies, shown plainly. */
  needs: string[]
  details: DetailChange[]
  children: DiffNode[]
  /** It or something inside it differs. */
  hasChange: boolean
}

export interface DiffTree {
  roots: DiffNode[]
  /** Every differing feature in tree order, for jumping through them. */
  order: DiffNode[]
  counts: Record<DiffKind, number> & { all: number }
  featureCount: { from: number; to: number; untouched: number; changed: number; added: number; removed: number }
}

const STATUS = (value?: string) => (value ? (STATUS_LABEL[value as FeatureStatus] ?? value) : '')

export function buildDiffTree(from: List, to: List): DiffTree {
  const before = new Map(from.features.map((row) => [row.key, row]))
  const after = new Map(to.features.map((row) => [row.key, row]))
  const releaseBefore = new Map(from.releases.map((r) => [r.key, r.name]))
  const releaseAfter = new Map(to.releases.map((r) => [r.key, r.name]))

  const path = (rows: Map<string, Row>, key: string) => {
    const names: string[] = []
    for (let current = key, steps = 0; current && steps <= rows.size; steps++) {
      const row = rows.get(current)
      if (!row) break
      names.unshift(row.title)
      current = row.parent_key
    }
    return names.join(' › ')
  }
  const names = (rows: Map<string, Row>, keys: string[]) => keys.map((k) => rows.get(k)?.title ?? '?')

  const nodes = new Map<string, DiffNode>()
  const blank = (key: string, title: string, state: DiffNode['state']): DiffNode => ({
    key,
    title,
    state,
    kinds: [],
    needsAdded: [],
    needsRemoved: [],
    needs: [],
    details: [],
    children: [],
    hasChange: false,
  })

  // The newer list, in its own order.
  for (const row of to.features) {
    const was = before.get(row.key)
    if (!was) {
      const node = blank(row.key, row.title, 'added')
      node.kinds.push('added')
      node.needs = names(after, row.needs)
      nodes.set(row.key, node)
      continue
    }
    const node = blank(row.key, row.title, 'same')
    if (was.title !== row.title) {
      node.oldTitle = was.title
      node.kinds.push('renamed')
    }
    if (was.parent_key !== row.parent_key) {
      node.movedFrom = was.parent_key ? path(before, was.parent_key) : ''
      node.kinds.push('moved')
    }
    const had = new Set(was.needs)
    const has = new Set(row.needs)
    node.needsAdded = names(after, row.needs.filter((k) => !had.has(k)))
    node.needsRemoved = names(before, was.needs.filter((k) => !has.has(k)))
    if (node.needsAdded.length || node.needsRemoved.length) node.kinds.push('needs')

    const detail = (label: string, a: string, b: string) => {
      if (a !== b) node.details.push({ label, from: a, to: b })
    }
    detail('Status', STATUS(was.status), STATUS(row.status))
    detail('Priority', was.priority ?? '', row.priority ?? '')
    detail('Category', was.category ?? '', row.category ?? '')
    detail('Release', releaseBefore.get(was.release_key) ?? '', releaseAfter.get(row.release_key) ?? '')
    detail('Description', was.description ?? '', row.description ?? '')
    if (node.details.length) node.kinds.push('details')

    if (node.kinds.length) node.state = 'changed'
    nodes.set(row.key, node)
  }

  const roots: DiffNode[] = []
  const childrenOf = (parentKey: string) => (parentKey && nodes.has(parentKey) ? nodes.get(parentKey)!.children : roots)
  for (const row of to.features) childrenOf(row.parent_key).push(nodes.get(row.key)!)

  // Rows that stand where something used to be: removed features, and the
  // old places of moved ones. Each goes in after the sibling it used to follow.
  const removedNodes = new Map<string, DiffNode>()
  const placeBack = (node: DiffNode, oldParent: string, oldIndex: number) => {
    // Under its old parent if that is still there, or was removed too.
    const siblings = removedNodes.get(oldParent)?.children ?? childrenOf(after.has(oldParent) ? oldParent : '')
    const oldSiblings = from.features.filter((r) => r.parent_key === oldParent)
    for (let i = oldIndex - 1; i >= 0; i--) {
      const at = siblings.findIndex((s) => s.key === oldSiblings[i].key && s.state !== 'ghost')
      if (at !== -1) {
        siblings.splice(at + 1, 0, node)
        return
      }
    }
    siblings.unshift(node)
  }
  for (const row of from.features) {
    const oldIndex = from.features.filter((r) => r.parent_key === row.parent_key).findIndex((r) => r.key === row.key)
    if (!after.has(row.key)) {
      const node = blank(`removed-${row.key}`, row.title, 'removed')
      node.kinds.push('removed')
      placeBack(node, row.parent_key, oldIndex)
      removedNodes.set(row.key, node)
      continue
    }
    const moved = nodes.get(row.key)!
    if (moved.kinds.includes('moved') && after.has(row.parent_key)) {
      const ghost = blank(`ghost-${row.key}`, row.title, 'ghost')
      const now = after.get(row.key)!
      ghost.movedTo = now.parent_key ? path(after, now.parent_key) : ''
      placeBack(ghost, row.parent_key, oldIndex)
    }
  }

  // Which branches hold a change, and the changes in tree order.
  const order: DiffNode[] = []
  const mark = (node: DiffNode): boolean => {
    if (node.state === 'changed' || node.state === 'added' || node.state === 'removed') order.push(node)
    let inside = false
    for (const child of node.children) inside = mark(child) || inside
    node.hasChange = node.state !== 'same' || inside
    return node.hasChange
  }
  roots.forEach(mark)

  const counts = { all: order.length, added: 0, removed: 0, renamed: 0, moved: 0, needs: 0, details: 0 }
  for (const node of order) for (const kind of node.kinds) counts[kind]++

  const changed = order.filter((n) => n.state === 'changed').length
  return {
    roots,
    order,
    counts,
    featureCount: {
      from: from.features.length,
      to: to.features.length,
      untouched: to.features.length - changed - counts.added,
      changed,
      added: counts.added,
      removed: counts.removed,
    },
  }
}
