import { parseDependencyMarkdown } from '@/lib/dependency-markdown'
import { fromProject, newKey, toMarkdown, type OpenedProject } from '@/lib/playground'
import { fetchCopy, fetchProjectForPlayground, fetchVersion, type SaveCopyRequest } from '@/lib/queries'

/** The name the downloaded list is saved under, the file people commit to their repo. */
export const FEATURE_FILE_NAME = 'FEATURES.md'

/**
 * Save a project's features as FEATURES.md: the same nested list with
 * `> needs:` that the playground writes and the import reads, so the file
 * can be committed, edited and brought back in.
 */
export async function downloadFeatureFile(projectId: number) {
  saveAsMarkdown(await fetchProjectForPlayground(projectId), FEATURE_FILE_NAME)
}

/** A name as it goes into a file name: "Food Delivery App" becomes "food-delivery-app". */
function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** What a version downloads as: the project and the version, e.g. food-delivery-app_v1.md. */
export function versionFileName(projectName: string, number: number) {
  return `${slug(projectName) || 'features'}_v${number}.md`
}

/** What a copy downloads as, e.g. food-delivery-app_v1_checkout-rework.md. */
export function copyFileName(projectName: string, baseNumber: number, copy: { name: string; number: number }) {
  return `${slug(projectName) || 'features'}_v${baseNumber}_${slug(copy.name) || `copy${copy.number}`}.md`
}

/**
 * Save a saved version of the list the same way, as it was when it was saved.
 * The file name carries the project and the version number, so it is not
 * mistaken for the current list or another project's.
 *
 * The file is stamped with the version it came from and a hidden key on each
 * feature, so once edited it can be uploaded back as a copy of that version.
 */
export async function downloadVersionFile(projectId: number, versionId: number) {
  const version = await fetchVersion(projectId, versionId)
  saveAsMarkdown(
    version.snapshot,
    versionFileName(version.snapshot.project.name, version.number),
    stampLine({ project: projectId, version: version.id }),
  )
}

/** Save one of your copies the same way, stamped so its next upload replaces it. */
export async function downloadCopyFile(projectId: number, copyId: number) {
  const copy = await fetchCopy(projectId, copyId)
  saveAsMarkdown(
    copy.snapshot,
    copyFileName(copy.snapshot.project.name, copy.base.number, copy),
    stampLine({ project: projectId, version: copy.base.id, copy: copy.id, revision: copy.revision }),
  )
}

function saveAsMarkdown(opened: OpenedProject, fileName: string, stamp?: string) {
  const { items } = fromProject(opened)
  const heading = opened.project.name || 'Features'
  const text = stamp ? toMarkdown(items, heading, { keys: true, stamp }) : toMarkdown(items, heading)
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

// ---------- the stamp ----------

interface Stamp {
  project: number
  version: number
  copy?: number
  revision?: number
}

/**
 * The hidden line under the heading. Like the `fp:` keys it is an HTML
 * comment, so a markdown viewer does not show it, and it says in plain words
 * what it is for in case someone opens the raw file.
 */
function stampLine(stamp: Stamp) {
  const parts = [`project=${stamp.project}`, `version=${stamp.version}`]
  if (stamp.copy) parts.push(`copy=${stamp.copy}`, `revision=${stamp.revision ?? 1}`)
  return `<!-- featureplus ${parts.join(' ')} · Keep this line and the fp: notes at the ends of lines: they tell FeaturePlus which version this file came from and which feature each line is. -->`
}

const STAMP = /<!--\s*featureplus\b(.*?)-->/i

function readStamp(text: string): Stamp | null {
  const found = STAMP.exec(text)
  if (!found) return null
  const values: Record<string, number> = {}
  for (const [, name, value] of found[1].matchAll(/(\w+)=(\d+)/g)) values[name] = Number(value)
  if (!values.project || !values.version) return null
  return { project: values.project, version: values.version, copy: values.copy, revision: values.revision }
}

// ---------- reading an edited file back ----------

/**
 * Read an edited version or copy file into what the upload sends: the version
 * it was made from, the copy it replaces if it was downloaded from one, and its
 * features as rows.
 *
 * Each line keeps the key its hidden `fp:` note names, so a renamed or moved
 * feature is still the same feature. A line without one, or one whose note was
 * copied from another line, is a new feature and gets a new key.
 *
 * Nothing is sent while the file has problems; they come back to be fixed.
 */
export function readCopyFile(text: string, projectId: number): { request: SaveCopyRequest } | { problems: string[] } {
  const stamp = readStamp(text)
  if (!stamp) {
    return {
      problems: [
        "This file has no FeaturePlus stamp, so there's no telling which version it came from. Download a version on this page, edit that file, and upload it.",
      ],
    }
  }
  if (stamp.project !== projectId) {
    return { problems: ['This file is from a different project. Upload it on that project\'s Versions page.'] }
  }

  const { graph, problems, refs } = parseDependencyMarkdown(text)
  if (graph.nodes.length === 0 && problems.length === 0) {
    problems.push('The file has no features in it. Features are lines starting with "- ".')
  }

  const keys = new Map<number, string>()
  const used = new Set<string>()
  for (const node of graph.nodes) {
    const ref = refs.get(node.id)
    const key = ref && !used.has(ref) ? ref : newKey()
    used.add(key)
    keys.set(node.id, key)
  }

  const parentOf = new Map(graph.nodes.map((node) => [node.id, node.parent_id]))
  const within = (id: number, ancestor: number) => {
    for (let current = parentOf.get(id) ?? null; current !== null; current = parentOf.get(current) ?? null) {
      if (current === ancestor) return true
    }
    return false
  }
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]))

  // An edge runs from what is needed (parent_id) to what waits (child_id).
  const needs = new Map<number, string[]>()
  for (const edge of graph.edges) {
    if (within(edge.child_id, edge.parent_id) || within(edge.parent_id, edge.child_id)) {
      problems.push(`"${titles.get(edge.child_id)}" cannot depend on ${titles.get(edge.parent_id)}: one is inside the other`)
      continue
    }
    needs.set(edge.child_id, [...(needs.get(edge.child_id) ?? []), keys.get(edge.parent_id)!])
  }

  if (problems.length > 0) return { problems }

  return {
    request: {
      base_version_id: stamp.version,
      ...(stamp.copy ? { copy_id: stamp.copy, revision: stamp.revision ?? 0 } : {}),
      features: graph.nodes.map((node) => ({
        key: keys.get(node.id)!,
        title: node.title,
        parent_key: node.parent_id === null ? '' : keys.get(node.parent_id)!,
        needs: needs.get(node.id) ?? [],
      })),
    },
  }
}
