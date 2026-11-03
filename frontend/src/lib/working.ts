import { useVersions, useWorking, type FeatureVersion } from '@/lib/queries'

/**
 * Where the working version (the Feature List) stands against its saved
 * versions:
 *
 * - latest: the version it is based on (v1.2): the one last saved, or the one
 *   last opened from the Versions page. Changes are counted from it, and the
 *   Versions page marks it Live.
 * - published: the newest published version, the list everyone reads (v2)
 * - newest: the newest saved version of all
 * - unsaved: how many features differ from `latest`; 0 means unchanged, which
 *   is when Publish shows
 * - nextSave / nextPublish: the numbers a save or a publish would get now
 * - note: what is being worked on, for everyone; a save offers it as its note
 *
 * Every edit is stored as it is made, so "unsaved" only means "not saved as a
 * version yet"; nothing is lost by leaving the page.
 */
export function useWorkingState(projectId: number) {
  const versions = useVersions(projectId)
  const working = useWorking(projectId)
  const list = versions.data ?? []
  const data = working.data ?? null

  const newest: FeatureVersion | null = list.reduce<FeatureVersion | null>(
    (best, v) => (!best || v.number > best.number ? v : best),
    null,
  )
  const published: FeatureVersion | null = list.reduce<FeatureVersion | null>(
    (best, v) => (v.publish_number > 0 && (!best || v.publish_number > best.publish_number) ? v : best),
    null,
  )
  // The base as the versions list has it, so its label and badges follow edits.
  const latest = data?.base ? (list.find((v) => v.id === data.base!.id) ?? data.base) : null
  // A count still on its way, or one for a base that just changed, is no answer.
  const counts = data?.unsaved && !working.isPlaceholderData ? data.unsaved : null
  const unsaved = latest && counts ? counts.added + counts.removed + counts.changed : null

  return {
    isLoading: versions.isLoading || working.isLoading,
    versions: list,
    latest,
    published,
    newest,
    /** null while it is being worked out, or when nothing is saved yet. */
    unsaved,
    /** The same changes split up: added, removed, changed. */
    unsavedCounts: latest ? counts : null,
    /** Nothing saved yet: every feature counts as a change. */
    neverSaved: working.isSuccess && !data?.base,
    nextSave: data?.next_save ?? 'v0.1',
    nextPublish: data?.next_publish ?? 'v1',
    note: data?.note ?? '',
    noteBy: data?.note_by ?? '',
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
