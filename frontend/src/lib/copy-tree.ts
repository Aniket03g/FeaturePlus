/**
 * A copy's feature list as the My Space editor holds it, and the edits it
 * makes: add, delete, move and change.
 *
 * Rows are kept in tree order, every parent before what sits inside it, the
 * way the server stores a list. A feature and everything inside it are
 * therefore always one unbroken run of rows, its branch, which is what makes
 * moving and deleting simple slices.
 */

import { MAX_DEPTH } from '@/lib/tree-drop'
import type { CopyFeature, CopyListRow } from '@/lib/queries'

export interface CopyRow {
  key: string
  title: string
  parent: string | null
  needs: string[]
  description: string
  notes: string
  status: string
  priority: string
  /** The real feature it came from; 0 for one added in the copy. */
  featureId: number
}

export function rowsFromSnapshot(features: CopyFeature[]): CopyRow[] {
  return features.map((f) => ({
    key: f.key,
    title: f.title,
    parent: f.parent_key || null,
    needs: f.needs ?? [],
    description: f.description ?? '',
    notes: f.notes ?? '',
    status: f.status || 'todo',
    priority: f.priority || 'medium',
    featureId: f.feature_id ?? 0,
  }))
}

export function rowsForSave(rows: CopyRow[]): CopyListRow[] {
  return rows.map((r) => ({
    key: r.key,
    title: r.title.trim() || 'Untitled',
    parent_key: r.parent ?? '',
    needs: r.needs,
    description: r.description,
    notes: r.notes,
    status: r.status,
    priority: r.priority,
  }))
}

/** Each row's depth, L0 = 0. */
export function depths(rows: CopyRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) out.set(r.key, r.parent ? (out.get(r.parent) ?? 0) + 1 : 0)
  return out
}

/** Where key's branch starts and ends (end exclusive) in rows. */
export function branchRange(rows: CopyRow[], key: string): [number, number] {
  const start = rows.findIndex((r) => r.key === key)
  if (start < 0) return [0, 0]
  const depth = depths(rows)
  const own = depth.get(key) ?? 0
  let end = start + 1
  while (end < rows.length && (depth.get(rows[end].key) ?? 0) > own) end++
  return [start, end]
}

/** How many levels a branch goes below its own top row. */
export function branchHeight(rows: CopyRow[], key: string): number {
  const [start, end] = branchRange(rows, key)
  const depth = depths(rows)
  const own = depth.get(key) ?? 0
  let height = 0
  for (let i = start; i < end; i++) height = Math.max(height, (depth.get(rows[i].key) ?? 0) - own)
  return height
}

/** A key for a feature added in the copy; the server keeps keys of this shape. */
export function newKey(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return 'n' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Puts rows (a branch) in as the index-th child of parent, or last past the end. */
function insertBranch(rows: CopyRow[], branch: CopyRow[], parent: string | null, index: number): CopyRow[] {
  const siblings = rows.filter((r) => r.parent === parent)
  let at: number
  if (index < siblings.length) {
    at = rows.findIndex((r) => r.key === siblings[index].key)
  } else if (parent === null) {
    at = rows.length
  } else {
    at = branchRange(rows, parent)[1]
  }
  const moved = [{ ...branch[0], parent }, ...branch.slice(1)]
  return [...rows.slice(0, at), ...moved, ...rows.slice(at)]
}

/** Adds a feature as the last child of parent (null for the top level). */
export function addRow(rows: CopyRow[], parent: string | null, title: string, key = newKey()): { rows: CopyRow[]; key: string } {
  const row: CopyRow = {
    key,
    title,
    parent,
    needs: [],
    description: '',
    notes: '',
    status: 'todo',
    priority: 'medium',
    featureId: 0,
  }
  return { rows: insertBranch(rows, [row], parent, Number.MAX_SAFE_INTEGER), key }
}

/** Removes a feature and everything inside it. */
export function deleteBranch(rows: CopyRow[], key: string): CopyRow[] {
  const [start, end] = branchRange(rows, key)
  return tidyNeeds([...rows.slice(0, start), ...rows.slice(end)])
}

/**
 * Moves a feature, with everything inside it, to be the index-th child of
 * parent. Refused (rows returned as they were) if that is inside itself or
 * deeper than L3.
 */
export function moveBranch(rows: CopyRow[], key: string, parent: string | null, index: number): CopyRow[] {
  const [start, end] = branchRange(rows, key)
  const branch = rows.slice(start, end)
  if (parent !== null && branch.some((r) => r.key === parent)) return rows
  const rest = [...rows.slice(0, start), ...rows.slice(end)]
  const parentDepth = parent === null ? -1 : (depths(rest).get(parent) ?? 0)
  if (parentDepth + 1 + branchHeight(rows, key) > MAX_DEPTH) return rows
  return tidyNeeds(insertBranch(rest, branch, parent, index))
}

export function updateRow(rows: CopyRow[], key: string, change: Partial<CopyRow>): CopyRow[] {
  return rows.map((r) => (r.key === key ? { ...r, ...change } : r))
}

/**
 * Drops dependencies that no longer make sense: on a feature that is gone, or
 * between a feature and anything it sits inside or that sits inside it, which
 * a move can cause and the server refuses.
 */
function tidyNeeds(rows: CopyRow[]): CopyRow[] {
  const parent = new Map(rows.map((r) => [r.key, r.parent]))
  const within = (key: string, ancestor: string) => {
    for (let p = parent.get(key); p; p = parent.get(p) ?? null) if (p === ancestor) return true
    return false
  }
  return rows.map((r) => {
    const needs = r.needs.filter((n) => parent.has(n) && n !== r.key && !within(r.key, n) && !within(n, r.key))
    return needs.length === r.needs.length ? r : { ...r, needs }
  })
}
