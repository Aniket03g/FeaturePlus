import { useState } from 'react'
import { Users } from 'lucide-react'
import { useMembers, useProject } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { useAuth } from '@/lib/auth'
import { ROLE_HINT, ROLE_LABEL, canManage, type ProjectRole } from '@/lib/types'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ShareDialog } from './ShareDialog'

const ROLE_ORDER: ProjectRole[] = ['owner', 'publisher', 'editor', 'viewer']

/**
 * The open project's team: who is on it and in what role, and what each role
 * may do. The owner (or an admin) adds people and changes roles through the
 * same Share dialog the lists use.
 */
export function ProjectTeam({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const { user } = useAuth()
  const project = useProject(projectId)
  const members = useMembers(projectId)
  const [sharing, setSharing] = useState(false)

  const mayManage = canManage(project.data?.my_role)
  const people = [...(members.data?.items ?? [])].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.user.name.localeCompare(b.user.name),
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Users className="h-4 w-4 text-faint" />
            Team
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            The people on {project.data?.name ?? 'this project'} and what each of them can do here.
          </p>
        </div>
        {project.data && (
          <Button size="sm" onClick={() => setSharing(true)}>
            <Users className="h-3.5 w-3.5" />
            {mayManage ? 'Add or change people' : 'Share'}
          </Button>
        )}
      </div>

      <Card>
        <CardBody className="p-0">
          {members.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : members.isError ? (
            <p className="px-4 py-6 text-sm text-danger">Could not load the team.</p>
          ) : (
            <ul className="divide-y divide-border">
              {people.map((m) => (
                <li key={m.user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {m.user.name || m.user.username}
                      {m.user.id === user?.id && <Badge tone="accent">you</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">{m.user.email}</p>
                  </div>
                  <Badge tone={m.role === 'owner' ? 'accent' : m.role === 'publisher' ? 'success' : 'neutral'}>
                    {ROLE_LABEL[m.role]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">What each role can do</h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[7rem_1fr]">
            {ROLE_ORDER.map((role) => (
              <div key={role} className="contents">
                <dt className="font-medium text-ink">{ROLE_LABEL[role]}</dt>
                <dd className="text-muted">{ROLE_HINT[role]}</dd>
              </div>
            ))}
          </dl>
          <p className="pt-1 text-xs text-faint">
            How the team uses versions and publishing is written in{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => navigate({ name: 'projectSettings', projectId })}>
              Project info › Conventions
            </button>
            .
          </p>
        </CardBody>
      </Card>

      {sharing && project.data && (
        <ShareDialog
          projectId={projectId}
          projectName={project.data.name}
          canManage={mayManage}
          onClose={() => setSharing(false)}
          onLeft={() => navigate({ name: 'projects' })}
        />
      )}
    </div>
  )
}
