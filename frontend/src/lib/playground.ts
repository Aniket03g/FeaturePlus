import { parseDependencyMarkdown } from '@/lib/dependency-markdown'

/**
 * The playground's list: feature names and how they nest, drafted before any
 * of it becomes a project.
 *
 * Rows are kept in one flat array in reading order — a parent, then
 * everything inside it, then its next sibling. That keeps a feature and its
 * children next to each other, so moving a feature is cutting one contiguous
 * slice and pasting it somewhere else, and drawing the list is a single pass.
 *
 * A row is an object rather than a name because it will carry more later
 * (files, a merge target); nothing here should assume it is only a title.
 */

export interface DraftFeature {
  /** The list's own id. The database has none for a row until it is imported. */
  key: string
  title: string
  parent: string | null
  /** Unticked rows stay in the list but are left out of an import. */
  include: boolean
  /** The release it is planned into, by key. Missing or unknown means not planned. */
  release?: string | null
  /** What it cannot start before, by key. Missing means nothing. */
  needs?: DraftNeed[]
  /**
   * The project feature this row was opened from, and its name, parent and
   * release at the time. Importing into that project renames and moves the
   * feature itself instead of adding a new one.
   */
  origin?: { id: number; title: string; parent: string | null; release?: string | null }
}

/**
 * One "this cannot start until that is finished". The AI's guesses arrive as
 * suggestions and stay out of an import until someone confirms them; a
 * dependency typed or pasted in by a person is confirmed from the start.
 */
export interface DraftNeed {
  key: string
  suggested: boolean
}

/** A release drafted in the playground. Their order in the array is the order they ship in. */
export interface DraftRelease {
  key: string
  name: string
  /** Already published in the project it was opened from: an import leaves it as it is. */
  published?: boolean
}

export type Place = 'before' | 'after' | 'inside'

let counter = 0
export function newKey() {
  counter += 1
  return `f${Date.now().toString(36)}${counter.toString(36)}`
}

// ---------- reading the tree ----------

export function childrenOf(items: DraftFeature[], parent: string | null) {
  return items.filter((item) => item.parent === parent)
}

export function depthOf(items: DraftFeature[], key: string) {
  const byKey = new Map(items.map((item) => [item.key, item]))
  let depth = 0
  let current = byKey.get(key)?.parent ?? null
  while (current !== null) {
    depth += 1
    current = byKey.get(current)?.parent ?? null
  }
  return depth
}

/** Where a row's slice starts, and how many rows it covers with its children. */
function sliceOf(items: DraftFeature[], key: string) {
  const start = items.findIndex((item) => item.key === key)
  if (start === -1) return { start: -1, length: 0 }

  const inside = new Set([key])
  let end = start + 1
  while (end < items.length && inside.has(items[end].parent ?? '')) {
    inside.add(items[end].key)
    end += 1
  }
  return { start, length: end - start }
}

/** True when `key` is `ancestor` or somewhere inside it. */
export function isWithin(items: DraftFeature[], key: string, ancestor: string) {
  const { start, length } = sliceOf(items, ancestor)
  return items.slice(start, start + length).some((item) => item.key === key)
}

/**
 * Rows that share their name with a sibling, by key. An import refuses them.
 * The same name under two different parents is fine. Siblings are counted
 * where the import puts them: a row inside an unticked one goes up to the
 * nearest ticked parent, so that is where it is compared.
 */
export function duplicateRows(items: DraftFeature[]) {
  const first = new Map<string, string>()
  const repeated = new Set<string>()
  for (const row of importRows(items)) {
    const name = `${row.parent_key}\n${row.title.toLowerCase()}`
    const earlier = first.get(name)
    if (earlier === undefined) {
      first.set(name, row.key)
      continue
    }
    repeated.add(earlier)
    repeated.add(row.key)
  }
  return repeated
}

// ---------- changing it ----------

export function addFeature(
  items: DraftFeature[],
  title: string,
  parent: string | null = null,
): DraftFeature[] {
  const row: DraftFeature = { key: newKey(), title, parent, include: true }
  if (parent === null) return [...items, row]

  // A new child goes last inside its parent.
  const { start, length } = sliceOf(items, parent)
  const next = [...items]
  next.splice(start + length, 0, row)
  return next
}

export function renameFeature(items: DraftFeature[], key: string, title: string) {
  return items.map((item) => (item.key === key ? { ...item, title } : item))
}

/** Remove a feature and everything inside it, and any dependency on them. */
export function removeFeature(items: DraftFeature[], key: string) {
  const { start, length } = sliceOf(items, key)
  if (start === -1) return items
  const gone = new Set(items.slice(start, start + length).map((item) => item.key))
  return [...items.slice(0, start), ...items.slice(start + length)].map((item) =>
    item.needs?.some((need) => gone.has(need.key))
      ? { ...item, needs: item.needs.filter((need) => !gone.has(need.key)) }
      : item,
  )
}

/** Tick or untick a feature, and everything inside it with it. */
export function setIncluded(items: DraftFeature[], key: string, include: boolean) {
  const { start, length } = sliceOf(items, key)
  const affected = new Set(items.slice(start, start + length).map((item) => item.key))
  return items.map((item) => (affected.has(item.key) ? { ...item, include } : item))
}

/**
 * Move a feature, with everything inside it, before, after or into another.
 * A move into its own subtree is refused, since a feature cannot sit inside
 * itself, and the list comes back unchanged.
 */
export function moveFeature(
  items: DraftFeature[],
  key: string,
  target: string | null,
  place: Place,
): DraftFeature[] {
  if (target !== null && isWithin(items, target, key)) return items

  const { start, length } = sliceOf(items, key)
  if (start === -1) return items

  const moving = items.slice(start, start + length)
  const rest = [...items.slice(0, start), ...items.slice(start + length)]

  // No target means the top level, at the end.
  if (target === null) {
    moving[0] = { ...moving[0], parent: null }
    return [...rest, ...moving]
  }

  const targetRow = rest.find((item) => item.key === target)
  if (!targetRow) return items

  const at = sliceOf(rest, target)
  const index = place === 'before' ? at.start : at.start + at.length
  moving[0] = { ...moving[0], parent: place === 'inside' ? target : targetRow.parent }

  return [...rest.slice(0, index), ...moving, ...rest.slice(index)]
}

function sibling(items: DraftFeature[], key: string, step: -1 | 1) {
  const row = items.find((item) => item.key === key)
  if (!row) return null
  const siblings = childrenOf(items, row.parent)
  return siblings[siblings.findIndex((s) => s.key === key) + step] ?? null
}

export function moveUp(items: DraftFeature[], key: string) {
  const previous = sibling(items, key, -1)
  return previous ? moveFeature(items, key, previous.key, 'before') : items
}

export function moveDown(items: DraftFeature[], key: string) {
  const next = sibling(items, key, 1)
  return next ? moveFeature(items, key, next.key, 'after') : items
}

/** Put a feature inside the one above it. */
export function indent(items: DraftFeature[], key: string) {
  const previous = sibling(items, key, -1)
  return previous ? moveFeature(items, key, previous.key, 'inside') : items
}

/** Take a feature out of its parent, to sit just after it. */
export function outdent(items: DraftFeature[], key: string) {
  const row = items.find((item) => item.key === key)
  if (!row?.parent) return items
  return moveFeature(items, key, row.parent, 'after')
}

// ---------- dependencies ----------

/**
 * Whether `from` may depend on `to`. Not on itself, and not up or down its own
 * nesting: a feature does not wait on its own parts, and being inside
 * something already says they belong together.
 */
export function canNeed(items: DraftFeature[], from: string, to: string) {
  if (from === to) return false
  return !isWithin(items, from, to) && !isWithin(items, to, from)
}

/** Add a confirmed dependency, or confirm it if the AI had suggested it. */
export function addNeed(items: DraftFeature[], from: string, to: string) {
  if (!canNeed(items, from, to)) return items
  return items.map((item) => {
    if (item.key !== from) return item
    const needs = item.needs ?? []
    return needs.some((need) => need.key === to)
      ? { ...item, needs: needs.map((need) => (need.key === to ? { ...need, suggested: false } : need)) }
      : { ...item, needs: [...needs, { key: to, suggested: false }] }
  })
}

export function removeNeed(items: DraftFeature[], from: string, to: string) {
  return items.map((item) =>
    item.key === from ? { ...item, needs: (item.needs ?? []).filter((need) => need.key !== to) } : item,
  )
}

/** Confirm every suggestion, or drop every suggestion, in one step. */
export function settleSuggestions(items: DraftFeature[], confirm: boolean) {
  return items.map((item) =>
    item.needs?.some((need) => need.suggested)
      ? {
          ...item,
          needs: confirm
            ? item.needs.map((need) => ({ ...need, suggested: false }))
            : item.needs.filter((need) => !need.suggested),
        }
      : item,
  )
}

export function suggestionCount(items: DraftFeature[]) {
  return items.reduce((sum, item) => sum + (item.needs ?? []).filter((need) => need.suggested).length, 0)
}

/** The features that need `key`, the other way round from a row's own needs. */
export function neededBy(items: DraftFeature[], key: string) {
  return items.filter((item) => item.needs?.some((need) => need.key === key))
}

/**
 * Dependencies that take part in a loop, as "from>to". A loop is allowed, the
 * same as on the canvas, but nothing in it can ever start, so it is pointed out.
 */
export function loopNeeds(items: DraftFeature[]) {
  const out = new Map<string, string[]>()
  for (const item of items) out.set(item.key, (item.needs ?? []).map((need) => need.key))

  const reaches = (from: string, target: string) => {
    const seen = new Set([from])
    const queue = [from]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === target) return true
      for (const next of out.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    return false
  }

  const looped = new Set<string>()
  for (const item of items) {
    for (const need of item.needs ?? []) {
      if (reaches(need.key, item.key)) looped.add(`${item.key}>${need.key}`)
    }
  }
  return looped
}

// ---------- the AI ----------

/** A row as the AI reads and writes it: the same shape the draft endpoint uses. */
export interface AiRow {
  key: string
  title: string
  parent_key: string
  needs: string[]
}

export function toAiRows(items: DraftFeature[]): AiRow[] {
  return items.map((item) => ({
    key: item.key,
    title: item.title,
    parent_key: item.parent ?? '',
    needs: (item.needs ?? []).map((need) => need.key),
  }))
}

/**
 * Put the AI's answer in place of the list. The AI answers with the whole
 * list, so rows it dropped are gone, and undo brings them back.
 *
 * A row it kept (same key) keeps its tick and its release, which the AI does
 * not see. A dependency that was already confirmed stays confirmed; every
 * other one it gives is a suggestion.
 */
export function applyAiRows(items: DraftFeature[], rows: AiRow[]): DraftFeature[] {
  const before = new Map(items.map((item) => [item.key, item]))
  return rows.map((row) => {
    const old = before.get(row.key)
    const confirmed = new Set((old?.needs ?? []).filter((need) => !need.suggested).map((need) => need.key))
    const next: DraftFeature = {
      key: row.key,
      title: row.title,
      parent: row.parent_key || null,
      include: old?.include ?? true,
      needs: row.needs.map((key) => ({ key, suggested: !confirmed.has(key) })),
    }
    if (old?.release) next.release = old.release
    if (old?.origin) next.origin = old.origin
    return next
  })
}

// ---------- releases ----------

/**
 * A release is a label on rows, not a second list: a feature is planned into
 * at most one release, the same rule the project's releases keep. The releases
 * themselves are an ordered array, first to ship first, so "what changed in
 * v1.1" is simply the features labelled v1.1, and "the product after v1.1" is
 * everything labelled v1.1 or earlier.
 */

/** The next name after the last release: v1.0, then v1.1, v1.2 and so on. */
export function nextReleaseName(releases: DraftRelease[]) {
  const last = releases[releases.length - 1]
  const match = last ? /^(v?)(\d+)\.(\d+)$/i.exec(last.name.trim()) : null
  if (match) return `${match[1]}${match[2]}.${Number(match[3]) + 1}`
  return releases.length === 0 ? 'v1.0' : `Release ${releases.length + 1}`
}

export function addRelease(releases: DraftRelease[], name = nextReleaseName(releases)): DraftRelease[] {
  return [...releases, { key: `r${newKey()}`, name }]
}

export function renameRelease(releases: DraftRelease[], key: string, name: string) {
  return releases.map((release) => (release.key === key ? { ...release, name } : release))
}

/** Move a release one place earlier or later in the order. */
export function shiftRelease(releases: DraftRelease[], key: string, step: -1 | 1) {
  const from = releases.findIndex((release) => release.key === key)
  const to = from + step
  if (from === -1 || to < 0 || to >= releases.length) return releases
  const next = [...releases]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** Remove a release. Whatever was planned into it goes back to not planned. */
export function removeRelease(items: DraftFeature[], releases: DraftRelease[], key: string) {
  return {
    items: items.map((item) => (item.release === key ? { ...item, release: null } : item)),
    releases: releases.filter((release) => release.key !== key),
  }
}

/**
 * Plan a feature into a release, or out of one with `null`. Everything inside
 * it goes along, the same way a move takes a feature's children with it; a
 * part can then be dragged on its own into a later release.
 */
export function planInto(items: DraftFeature[], key: string, release: string | null) {
  const { start, length } = sliceOf(items, key)
  if (start === -1) return items
  const affected = new Set(items.slice(start, start + length).map((item) => item.key))
  return items.map((item) => (affected.has(item.key) ? { ...item, release } : item))
}

/**
 * Where each row ships: the index of its release in the order, or -1 when it
 * is not planned. A label naming a release that no longer exists counts as
 * not planned.
 */
export function shipOrder(items: DraftFeature[], releases: DraftRelease[]) {
  const position = new Map(releases.map((release, index) => [release.key, index]))
  return new Map(items.map((item) => [item.key, item.release ? (position.get(item.release) ?? -1) : -1]))
}

/**
 * Rows planned into an earlier release than the feature they sit inside —
 * "Kanban Views" going out in v1.0 while "Dashboard" waits for v1.1. That is
 * allowed but usually a slip, so the views point it out. A parent that is not
 * planned at all is taken as a plain grouping and not flagged.
 */
export function shipsBeforeParent(items: DraftFeature[], releases: DraftRelease[]) {
  const order = shipOrder(items, releases)
  const flagged = new Map<string, string>()
  for (const item of items) {
    if (!item.parent) continue
    const mine = order.get(item.key) ?? -1
    const parents = order.get(item.parent) ?? -1
    if (mine !== -1 && parents !== -1 && mine < parents) flagged.set(item.key, item.parent)
  }
  return flagged
}

/**
 * The names above a row, outermost first, stopping at the first one `inGroup`
 * accepts. A card shows these as "Dashboard ›" when its parent is somewhere
 * else, and indents under its parent instead when the parent is right there.
 */
export function outsidePath(items: DraftFeature[], key: string, inGroup: (key: string) => boolean) {
  const byKey = new Map(items.map((item) => [item.key, item]))
  const path: string[] = []
  let depth = 0
  let current = byKey.get(key)?.parent ?? null
  while (current !== null && inGroup(current)) {
    depth += 1
    current = byKey.get(current)?.parent ?? null
  }
  while (current !== null) {
    const row = byKey.get(current)
    if (!row) break
    path.unshift(row.title || 'Untitled')
    current = row.parent
  }
  return { path, depth }
}

// ---------- text in and out ----------

/**
 * The line the copied AI instructions ask an outside AI to start its answer
 * with. Its presence is how a pasted or opened list is known to be an AI's.
 */
export const AI_DRAFT_MARKER = 'FeaturePlus AI draft'

const MARKER_LINE = /^\s*(?:#+\s*)?featureplus ai draft\s*$/i

export function isAiDraft(text: string) {
  return text.split(/\r?\n/).some((line) => MARKER_LINE.test(line))
}

/**
 * Read a list from text. Bullets nest by indentation, the same format the
 * dependency canvas reads, so a file made for one opens in the other. Plain
 * lines with no bullets at all are taken as one feature each, which is what a
 * list pasted from anywhere else usually looks like.
 *
 * `needs:` is kept, as confirmed dependencies: whoever wrote the file meant
 * them. Status tags are read without complaint and dropped. The exception is
 * an outside AI's answer, marked by AI_DRAFT_MARKER: its dependencies are
 * guesses, so they come in as suggestions to confirm, like Ask AI's.
 */
export function fromText(text: string): { items: DraftFeature[]; problems: string[] } {
  const suggested = isAiDraft(text)
  const lines = text.split(/\r?\n/).filter((line) => !MARKER_LINE.test(line))
  const hasBullets = lines.some((line) => /^\s*[-*+]\s+/.test(line))
  const source = hasBullets
    ? lines.join('\n')
    : lines
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => `- ${line}`)
        .join('\n')

  const { graph, problems } = parseDependencyMarkdown(source)
  const keys = new Map<number, string>()
  const items: DraftFeature[] = graph.nodes.map((node) => {
    const key = newKey()
    keys.set(node.id, key)
    return {
      key,
      title: node.title,
      parent: node.parent_id === null ? null : (keys.get(node.parent_id) ?? null),
      include: true,
    }
  })

  // An edge runs from what is needed (parent_id) to what waits (child_id).
  const byKey = new Map(items.map((item) => [item.key, item]))
  for (const edge of graph.edges) {
    const waiting = byKey.get(keys.get(edge.child_id) ?? '')
    const needed = keys.get(edge.parent_id)
    if (!waiting || !needed) continue
    if (!canNeed(items, waiting.key, needed)) {
      problems.push(`"${waiting.title}" cannot wait on ${byKey.get(needed)?.title ?? 'that'}: one is inside the other`)
      continue
    }
    waiting.needs = [...(waiting.needs ?? []), { key: needed, suggested }]
  }

  return { items, problems }
}

/**
 * The list as a file. Confirmed dependencies are written as `needs:`; suggestions are not.
 *
 * With `keys`, each line also ends in a hidden `<!-- fp:KEY -->` naming its row,
 * and `stamp` is written under the heading, so an edited file can be matched
 * back to the list it came from.
 */
export function toMarkdown(items: DraftFeature[], heading = 'Features', options: { keys?: boolean; stamp?: string } = {}) {
  const titles = new Map(items.map((item) => [item.key, item.title.trim()]))
  const lines = [`# ${heading}`, '']
  if (options.stamp) lines.push(options.stamp, '')
  for (const item of items) {
    const indentBy = '  '.repeat(depthOf(items, item.key))
    const needs = (item.needs ?? [])
      .filter((need) => !need.suggested && titles.get(need.key))
      .map((need) => titles.get(need.key))
    lines.push(
      `${indentBy}- ${item.title.trim() || 'Untitled'}${needs.length > 0 ? ` > needs: ${needs.join(', ')}` : ''}` +
        (options.keys ? ` <!-- fp:${item.key} -->` : ''),
    )
  }
  lines.push('')
  return lines.join('\n')
}

// ---------- import ----------

export interface ImportRow {
  key: string
  title: string
  parent_key: string
  /** The release it is planned into, by key; missing when it is not planned. */
  release_key?: string
  /** Confirmed dependencies on other rows being sent, by key. */
  needs?: string[]
  /** The feature the row was opened from, and whether the list moved it. */
  feature_id?: number
  moved?: boolean
}

/**
 * The rows an import sends: the ticked ones. A ticked feature inside an
 * unticked one moves up to the nearest ticked ancestor, rather than being
 * dropped or pointing at something that is not being sent.
 *
 * A row's release goes with it when that release still exists. Only confirmed
 * dependencies go, and only on rows that are being sent too: a dependency on
 * an unticked row is dropped rather than moved, since a parent is not what
 * was needed.
 */
export function importRows(items: DraftFeature[], releases: DraftRelease[] = []): ImportRow[] {
  const known = new Set(releases.map((release) => release.key))
  const byKey = new Map(items.map((item) => [item.key, item]))
  const nearestIncluded = (parent: string | null): string => {
    let current = parent
    while (current !== null) {
      const row = byKey.get(current)
      if (!row) return ''
      if (row.include) return row.key
      current = row.parent
    }
    return ''
  }

  const sent = items.filter((item) => item.include && item.title.trim())
  const sentKeys = new Set(sent.map((item) => item.key))

  return sent.map((item) => {
    const needs = (item.needs ?? [])
      .filter((need) => !need.suggested && sentKeys.has(need.key))
      .map((need) => need.key)
    return {
      key: item.key,
      title: item.title.trim(),
      parent_key: nearestIncluded(item.parent),
      ...(item.release && known.has(item.release) ? { release_key: item.release } : {}),
      ...(needs.length > 0 ? { needs } : {}),
      ...(item.origin ? { feature_id: item.origin.id, moved: item.parent !== item.origin.parent } : {}),
    }
  })
}

/** The releases an import sends, in shipping order, with blank names left out. */
export function importReleases(releases: DraftRelease[]) {
  return releases
    .filter((release) => release.name.trim())
    .map((release) => ({ key: release.key, name: release.name.trim() }))
}

/** A project as the server opens it for the playground. */
export interface OpenedProject {
  project: { id: number; name: string }
  features: {
    key: string
    title: string
    parent_key: string
    needs: string[]
    release_key: string
    feature_id: number
  }[]
  releases: { key: string; name: string; published: boolean }[]
}

/**
 * Turn an opened project into a list. Its dependencies are confirmed: they are
 * already in the project. Every row remembers the feature it came from.
 */
export function fromProject(opened: OpenedProject): { items: DraftFeature[]; releases: DraftRelease[] } {
  const releases = opened.releases.map((release) => ({
    key: release.key,
    name: release.name,
    ...(release.published ? { published: true } : {}),
  }))
  const items = opened.features.map((row) => ({
    key: row.key,
    title: row.title,
    parent: row.parent_key || null,
    include: true,
    release: row.release_key || null,
    needs: row.needs.map((key) => ({ key, suggested: false })),
    origin: { id: row.feature_id, title: row.title, parent: row.parent_key || null, release: row.release_key || null },
  }))
  return { items, releases }
}

/**
 * After an import, tie each sent row to the feature it became, as if the list
 * had just been opened from that project. A later import then renames and
 * moves those features instead of adding new ones.
 */
export function linkToProject(items: DraftFeature[], outcomes: { key: string; feature_id: number }[]) {
  const ids = new Map(outcomes.filter((o) => o.feature_id > 0).map((o) => [o.key, o.feature_id]))
  return items.map((item) => {
    const id = ids.get(item.key)
    return id
      ? { ...item, origin: { id, title: item.title.trim(), parent: item.parent, release: item.release ?? null } }
      : item
  })
}

/** Rows opened from a project that the list has renamed or moved since. */
export function changedFromProject(items: DraftFeature[]) {
  return items.filter(
    (item) => item.origin && (item.title.trim() !== item.origin.title || item.parent !== item.origin.parent),
  ).length
}

/**
 * Ticked rows opened from a project that the list has planned into a different
 * release. A row saved before the release was remembered counts as unchanged.
 */
export function replannedFromProject(items: DraftFeature[]) {
  return items.filter(
    (item) =>
      item.include &&
      item.origin &&
      item.origin.release !== undefined &&
      (item.release ?? null) !== (item.origin.release ?? null),
  ).length
}

export const PLAYGROUND_EXAMPLE = `# Store

- Accounts
  - Sign in
  - Profiles
- Catalogue > needs: Sign in
  - Listings
  - Search > needs: Listings
- Checkout
  - Cart > needs: Listings
  - Payment > needs: Cart
- Reporting > needs: Payment
`
