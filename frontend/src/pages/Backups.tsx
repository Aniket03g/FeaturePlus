import { useState } from 'react'
import { AlertCircle, Archive, ArchiveRestore, Loader2 } from 'lucide-react'
import { useProjects } from '@/lib/queries'
import { downloadBackup } from '@/lib/backup'
import { ApiError } from '@/lib/api'
import { useRouter } from '@/lib/router'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RestoreBackupDialog } from './RestoreBackupDialog'
import { cn } from '@/lib/utils'
import type { Project } from '@/lib/types'

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })

/**
 * Tools › Backup & Restore: take a backup of any project you own, or restore
 * one as a new project. Only owners can take a backup, so only their projects
 * are listed; anyone can restore, as the result is a new project of their own.
 */
export function Backups() {
  const { navigate } = useRouter()
  const projects = useProjects({ per_page: 200 })
  const [restoring, setRestoring] = useState(false)
  const owned = (projects.data?.items ?? []).filter((p) => p.my_role === 'owner')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Backup &amp; Restore</h2>
        <p className="mt-0.5 text-sm text-muted">
          A backup is one file with everything in a project. Restoring it always makes a new project, so nothing here is
          overwritten.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-60">
            <p className="text-sm font-medium text-ink">Restore a backup</p>
            <p className="text-xs text-muted">
              Upload a backup file from this or another FeaturePlus. You see what's in it before anything is saved.
            </p>
          </div>
          <Button size="sm" onClick={() => setRestoring(true)}>
            <ArchiveRestore className="h-3.5 w-3.5" />
            Restore backup
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Back up a project</CardTitle>
        </CardHeader>
        {projects.isLoading ? (
          <CardBody>
            <Skeleton className="h-24 w-full" />
          </CardBody>
        ) : projects.isError ? (
          <CardBody className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            Could not load your projects.
            <Button variant="secondary" size="sm" onClick={() => projects.refetch()}>
              Try again
            </Button>
          </CardBody>
        ) : owned.length === 0 ? (
          <CardBody className="text-sm text-muted">
            You don't own any projects. Only a project's owner can take a backup of it.
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {owned.map((p) => (
              <BackupRow key={p.id} project={p} />
            ))}
          </ul>
        )}
      </Card>

      {restoring && (
        <RestoreBackupDialog
          onClose={() => setRestoring(false)}
          onOpenProject={(projectId) => {
            setRestoring(false)
            navigate({ name: 'project', projectId })
          }}
        />
      )}
    </div>
  )
}

function BackupRow({ project }: { project: Project }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [message, setMessage] = useState('')

  async function download() {
    setState('busy')
    try {
      await downloadBackup(project.id)
      setState('idle')
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Download failed')
      setState('failed')
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 basis-48">
        <span className="block truncate text-sm font-medium text-ink">{project.name}</span>
        <span className={cn('block text-xs', state === 'failed' ? 'text-danger' : 'text-muted')}>
          {state === 'failed' ? message : `Last changed ${when(project.updated_at)}`}
        </span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={download}
        disabled={state === 'busy'}
        title="Download everything in this project as one file, to keep safe or restore elsewhere"
      >
        {state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
        {state === 'busy' ? 'Packing…' : state === 'failed' ? 'Try again' : 'Backup'}
      </Button>
    </li>
  )
}
