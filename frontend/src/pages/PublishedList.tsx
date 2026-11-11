import { useState } from 'react'
import { AlertCircle, ArrowLeft, Network, Users } from 'lucide-react'
import { useProject, useVersionsWithChanges } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ShareDialog } from './ShareDialog'
import { ProjectListTabs, VersionsTable } from './VersionsPage'
import { ROLE_LABEL, canDownload, canEditPlan, canManage, canPublish } from '@/lib/types'

/**
 * The Published tab: the project's published versions, shown in the same
 * table as the Versions tab but filtered to publishes only (v1, v2…). The
 * published feature list itself is read from a version's row, not here.
 */
export function PublishedList({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const versions = useVersionsWithChanges(projectId)
  const [sharing, setSharing] = useState(false)

  const role = project.data?.my_role
  const canSave = role !== undefined && role !== 'viewer'

  if (project.isError) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
          <span className="text-muted">
            {project.error instanceof ApiError ? project.error.message : 'Could not load the project'}
          </span>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-8 w-8 shrink-0 p-0"
          onClick={() => navigate({ name: 'projects' })}
          aria-label="Back to projects"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0 flex-1">
          {project.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-ink">{project.data?.name}</h2>
                <Badge>Published</Badge>
                {role && role !== 'owner' && (
                  <Badge tone={role === 'admin' ? 'warning' : 'neutral'}>{ROLE_LABEL[role]}</Badge>
                )}
              </div>
              {project.data?.description && <p className="mt-0.5 text-sm text-muted">{project.data.description}</p>}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'dependencies', projectId })}>
            <Network className="h-3.5 w-3.5" />
            Dependencies
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSharing(true)}>
            <Users className="h-3.5 w-3.5" />
            Share
          </Button>
        </div>
      </div>

      <ProjectListTabs projectId={projectId} active="published" />

      <VersionsTable
        projectId={projectId}
        versions={versions}
        publishedOnly
        canSave={canSave}
        mayPublish={canPublish(role)}
        mayOpen={canEditPlan(role)}
        mayDownload={canDownload(role)}
      />

      {sharing && project.data && (
        <ShareDialog
          projectId={projectId}
          projectName={project.data.name}
          canManage={canManage(role)}
          onClose={() => setSharing(false)}
          onLeft={() => navigate({ name: 'projects' })}
        />
      )}
    </div>
  )
}
