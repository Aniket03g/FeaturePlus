import { useState } from 'react'
import { ShieldCheck, UserPlus, X } from 'lucide-react'
import { useFeatureScopes, useGrantScope, useRevokeScope, useUsers } from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ACCESS_LABEL, type AccessLevel } from '@/lib/types'

const LEVELS: AccessLevel[] = ['owner', 'contract']

/**
 * Who can see this feature, and how much of it.
 *
 * A grant of full source means the holder reads this feature's mapped files
 * whole, reads the files of what it depends on as stripped contracts, and sees
 * nothing else in the project. Only the project's owner can change this — a
 * manager cannot, because handing out access to somebody's source is not an
 * administrative act.
 */
export function FeatureAccess({
  featureId,
  projectId,
  ownerId,
}: {
  featureId: number
  projectId: number
  ownerId: number
}) {
  const { user } = useAuth()
  const scopes = useFeatureScopes(featureId)
  const users = useUsers()
  const grant = useGrantScope(featureId, projectId)
  const revoke = useRevokeScope(featureId, projectId)

  const [adding, setAdding] = useState(false)
  const [pickedUser, setPickedUser] = useState(0)
  const [level, setLevel] = useState<AccessLevel>('contract')
  const [error, setError] = useState('')

  // The owner, or an admin acting for them.
  const isOwner = user?.id === ownerId || user?.role === 'admin'
  const items = scopes.data?.items ?? []

  // Somebody already granted, and the project's owner, are not candidates: the
  // first would be a change rather than an addition, and the second already
  // sees everything.
  const granted = new Set(items.map((s) => s.user_id))
  const candidates = (users.data?.items ?? []).filter(
    (candidate) => !granted.has(candidate.id) && candidate.id !== ownerId,
  )

  async function submit() {
    setError('')
    try {
      await grant.mutateAsync({ user_id: pickedUser, access_level: level })
      setAdding(false)
      setPickedUser(0)
      setLevel('contract')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-faint" />
          Access
        </CardTitle>
        {isOwner && !adding && candidates.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setAdding(true)}>
            <UserPlus className="h-3 w-3" />
            Grant
          </Button>
        )}
      </CardHeader>

      <CardBody className="space-y-3">
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        {adding && (
          <div className="space-y-2 rounded-md border border-border bg-raised/40 p-3">
            <div className="space-y-1.5">
              <label htmlFor="grant-user" className="block text-xs font-medium text-muted">
                Person
              </label>
              <select
                id="grant-user"
                value={pickedUser}
                onChange={(e) => setPickedUser(Number(e.target.value))}
                className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value={0}>Choose someone…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name || candidate.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted">Level</span>
              <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Access level">
                {LEVELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setLevel(option)}
                    aria-pressed={level === option}
                    className={cn(
                      'flex-1 rounded px-2 py-1 text-2xs transition-colors',
                      level === option
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    {ACCESS_LABEL[option]}
                  </button>
                ))}
              </div>
              <p className="text-2xs text-faint">
                {level === 'owner'
                  ? 'Reads this feature’s files in full, and its dependencies as contracts.'
                  : 'Reads a stripped contract of this feature’s files, never the implementation.'}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} loading={grant.isPending} disabled={pickedUser === 0}>
                Grant access
              </Button>
            </div>
          </div>
        )}

        {scopes.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : items.length === 0 ? (
          <p className="text-xs text-muted">
            Nobody outside the project owner can see this feature.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((scope) => (
              <li key={scope.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {scope.user?.name || scope.user?.username || `User ${scope.user_id}`}
                </span>
                <Badge tone={scope.access_level === 'owner' ? 'accent' : 'neutral'}>
                  {ACCESS_LABEL[scope.access_level] ?? scope.access_level}
                </Badge>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0"
                    onClick={() => revoke.mutate(scope.id)}
                    aria-label={`Revoke access for ${scope.user?.username ?? scope.user_id}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
