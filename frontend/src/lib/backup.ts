import { ApiError, upload } from '@/lib/api'

/**
 * Backups: a whole project in one .zip, made by its owner, that can be
 * restored as a new project here or on another FeaturePlus.
 */

export interface BackupCounts {
  features: number
  tasks: number
  comments: number
  files: number
  versions: number
  copies: number
  releases: number
  pull_requests: number
  people: number
}

/** What a backup holds and what restoring it here would do. Checking saves nothing. */
export interface BackupCheck {
  project_name: string
  made_on: string
  counts: BackupCounts
  /** The name the new project gets, e.g. "Hiking App (restored 26 Oct)". */
  restore_as: string
  /** Who the project was shared with, and whether each has an account here. */
  people: { email: string; role: string; found: boolean }[]
  /** Everyone named in the backup who has no account here. */
  missing: string[]
  /** How many things those people wrote, which will show as written by you. */
  credited_to_you: number
  /** Attached files that were already missing when the backup was made. */
  files_missing: number
}

export interface RestoreResult {
  project_id: number
  project_name: string
  report: BackupCheck
}

export function checkBackup(file: File) {
  return upload<BackupCheck>('/backups/check', file)
}

export function restoreBackup(file: File) {
  return upload<RestoreResult>('/backups/restore', file)
}

/**
 * Download a project's backup. It is fetched rather than linked to, so a
 * refusal shows as a message instead of a page of JSON, and the button can
 * show it is working while a large project is packed.
 */
export async function downloadBackup(projectId: number) {
  const response = await fetch(new URL(`/api/v1/projects/${projectId}/backup`, window.location.origin), {
    credentials: 'include',
  })
  if (!response.ok) {
    let message = `Download failed (${response.status})`
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } }
      if (payload.error?.message) message = payload.error.message
    } catch {
      // Not JSON: keep the plain message.
    }
    throw new ApiError('internal_error', message, {}, response.status)
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'featureplus_backup.zip'
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
