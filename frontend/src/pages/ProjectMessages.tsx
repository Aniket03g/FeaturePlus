import { MessageSquare } from 'lucide-react'
import { useProject, useProjectMessages } from '@/lib/queries'
import { useRouter } from '@/lib/router'
import { Card, CardBody } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { jumpToMessage } from '@/components/FeatureMessages'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Everything said on the project's features, newest first. Each message leads
 * to its feature, where the conversation is and where to reply.
 */
export function ProjectMessages({ projectId }: { projectId: number }) {
  const { navigate } = useRouter()
  const project = useProject(projectId)
  const messages = useProjectMessages(projectId)
  const list = messages.data ?? []

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <MessageSquare className="h-4 w-4 text-faint" />
          Messages
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          The latest messages on {project.data?.name ?? 'this project'}'s features. Open a feature to reply.
        </p>
      </div>

      <Card>
        <CardBody className="p-0">
          {messages.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : messages.isError ? (
            <p className="px-4 py-6 text-sm text-danger">Could not load the messages.</p>
          ) : list.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <MessageSquare className="mx-auto mb-2 h-5 w-5 text-faint" />
              <p className="text-sm text-muted">No messages yet.</p>
              <p className="mt-0.5 text-xs text-faint">Anyone on the project can leave one on a feature's page.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {list.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      jumpToMessage(m.id)
                      navigate({ name: 'feature', projectId, featureId: m.feature_id, editable: true })
                    }}
                    className="block w-full px-4 py-3 text-left transition-colors hover:bg-raised"
                  >
                    <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="font-medium text-accent">{m.feature_title || 'A removed feature'}</span>
                      <span className="text-ink">{m.author.name || 'Someone since removed'}</span>
                      <span className="text-faint">
                        {when(m.created_at)}
                        {m.edited && ' · edited'}
                      </span>
                    </p>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-ink">{m.content}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
