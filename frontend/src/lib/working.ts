import { useVersionComparison, useVersions, type FeatureVersion } from '@/lib/queries'

/**
 * Where the Feature List stands against its saved versions:
 *
 * - latest: the newest saved version (v2.2), what "changes since" counts from
 * - live: the published version everyone reads (v2)
 * - unsaved: how many features changed since `latest`; 0 means everything is
 *   saved, which is when Publish shows
 * - nextSave / nextPublish: the labels a save or a publish would get now
 *
 * Every edit is stored as it is made, so "unsaved" only means "not saved as a
 * version yet"; nothing is lost by leaving the page.
 */
export function useWorkingState(projectId: number) {
  const versions = useVersions(projectId)
  const list = versions.data ?? []
  const latest: FeatureVersion | null = list.reduce<FeatureVersion | null>(
    (best, v) => (!best || v.number > best.number ? v : best),
    null,
  )
  const live: FeatureVersion | null = list.reduce<FeatureVersion | null>(
    (best, v) => (v.publish_number > 0 && (!best || v.publish_number > best.publish_number) ? v : best),
    null,
  )
  const sinceLatest = useVersionComparison(projectId, latest ? latest.id : null, latest ? 'current' : null)
  // An answer for another version (shown while the new one loads) is no
  // answer: it would show Save just after saving, or Publish just after an edit.
  const current = sinceLatest.data && !sinceLatest.isPlaceholderData ? sinceLatest.data : null
  const unsaved = latest && current ? current.added + current.removed + current.changed : null

  const nextSave = latest ? `v${latest.major}.${latest.minor + 1}` : 'v0.1'
  const nextPublish = `v${(latest?.major ?? 0) + 1}`

  return {
    isLoading: versions.isLoading,
    versions: list,
    latest,
    live,
    /** null while it is being worked out, or when nothing is saved yet. */
    unsaved,
    /** The same changes split up: added, removed, changed. */
    unsavedCounts: latest && current
      ? { added: current.added, removed: current.removed, changed: current.changed }
      : null,
    /** Nothing saved yet: every feature counts as a change. */
    neverSaved: versions.isSuccess && !latest,
    nextSave,
    nextPublish,
  }
}

/**
 * What a version says about itself. Versions saved before notes replaced tags
 * have a tag, which names them best; "Published #N" tags were made up by the
 * server and say nothing the number does not, so the note is used instead.
 */
export function versionNote(v: Pick<FeatureVersion, 'notes' | 'tag'>) {
  const tag = /^Published #\d+/.test(v.tag) ? '' : v.tag
  return tag || v.notes || ''
}
