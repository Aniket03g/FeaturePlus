import { fromProject, toMarkdown } from '@/lib/playground'
import { fetchProjectForPlayground } from '@/lib/queries'

/** The name the downloaded list is saved under, the file people commit to their repo. */
export const FEATURE_FILE_NAME = 'FEATURES.md'

/**
 * Save a project's features as FEATURES.md: the same nested list with
 * `> needs:` that the playground writes and the import reads, so the file
 * can be committed, edited and brought back in.
 */
export async function downloadFeatureFile(projectId: number) {
  const opened = await fetchProjectForPlayground(projectId)
  const { items } = fromProject(opened)
  const blob = new Blob([toMarkdown(items, opened.project.name || 'Features')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = FEATURE_FILE_NAME
  link.click()
  URL.revokeObjectURL(url)
}
