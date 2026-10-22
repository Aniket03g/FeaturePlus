/**
 * Where a feature dragged in the list would land.
 *
 * The list is drawn as rows, each at a depth (L0, L1, …). A drop either sits
 * in a gap between two rows, at a depth the person picks by sliding left or
 * right, or lands on a row and goes inside it. Either way it comes down to a
 * parent (null for the top level) and a place among that parent's children,
 * which is what the server's move takes.
 *
 * The rows passed in are the ones on screen without the dragged feature and
 * anything inside it: they can't be a target.
 */

export interface DropRow {
  id: number
  depth: number
  parentId: number | null
}

export interface DropTarget {
  parentId: number | null
  /** Place among the parent's children, from 0; past the end means last. */
  index: number
  depth: number
  /** The row the line sits above (rows.length for below the last row); -1 when going inside a row. */
  gap: number
  /** The row it goes inside, when dropped onto one. */
  into?: number
}

/** The deepest level a feature can sit at: L0 to L3. */
export const MAX_DEPTH = 3

/**
 * A drop in the gap above rows[gap], at about the wanted depth. The depth is
 * kept to what makes sense there: no deeper than one below the row above, no
 * shallower than the row below (or that row would end up under the wrong
 * parent), and shallow enough that the dragged branch, `height` levels deep
 * itself, stays within L3. Null when no depth fits.
 */
export function gapTarget(rows: DropRow[], gap: number, wanted: number, height: number): DropTarget | null {
  const prev = gap > 0 ? rows[gap - 1] : undefined
  const next = gap < rows.length ? rows[gap] : undefined
  const min = next ? next.depth : 0
  const max = Math.min(prev ? prev.depth + 1 : 0, MAX_DEPTH - height)
  if (min > max) return null
  const depth = Math.max(min, Math.min(max, wanted))

  let parentId: number | null = null
  if (depth > 0) {
    for (let i = gap - 1; i >= 0; i--) {
      if (rows[i].depth === depth - 1) {
        parentId = rows[i].id
        break
      }
    }
  }
  let index = 0
  for (let i = 0; i < gap; i++) if (rows[i].parentId === parentId && rows[i].depth === depth) index++
  return { parentId, index, depth, gap }
}

/** A drop onto rows[at]: it goes inside that feature, last. Null past L3. */
export function intoTarget(rows: DropRow[], at: number, height: number): DropTarget | null {
  const row = rows[at]
  if (!row || row.depth + 1 + height > MAX_DEPTH) return null
  return { parentId: row.id, index: 1_000_000, depth: row.depth + 1, gap: -1, into: row.id }
}
