import { useState } from 'react'
import { AlertCircle, Check, Pencil, Trash2, Users, X } from 'lucide-react'
import { useDeleteUser, useResetUserPassword, useUpdateUser, useUsers } from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/layouts/AppShell'
import { cn, plural } from '@/lib/utils'
import type { User } from '@/lib/types'

const ROLES = ['developer', 'manager', 'admin'] as const

/**
 * The people on this instance.
 *
 * An admin sees everyone on the server; anyone else sees the people they share
 * a project with. Editing is narrower: your own account, or anyone's if you
 * are an admin — and only an admin can change a role, since a user who could
 * set their own would promote themselves.
 *
 * An admin editing someone else can also set a new password for them, for when
 * they have forgotten it. The old one cannot be shown: only its hash is stored.
 * Your own password is changed from the user menu, which asks for the current one.
 */
export function Team() {
  const { user: me } = useAuth()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(0)
  const [error, setError] = useState('')

  const users = useUsers({ q: search })
  const remove = useDeleteUser()

  const isAdmin = me?.role === 'admin'
  const items = users.data?.items ?? []

  async function handleDelete(user: User) {
    setError('')
    try {
      await remove.mutateAsync(user.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">Team</h2>
          <p className="mt-0.5 text-sm text-muted">
            Everyone who can sign in. Access to individual features is granted per project.
          </p>
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search people…" />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          {users.isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-4 w-48" />
                </div>
              ))}
            </div>
          ) : users.isError ? (
            <div className="px-4 py-12 text-center">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-soft text-danger">
                <AlertCircle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-ink">Could not load the team</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => users.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <Users className="mx-auto mb-2 h-5 w-5 text-faint" />
              <p className="text-sm text-muted">
                {search ? 'Nobody matches that search' : 'No people yet'}
              </p>
            </div>
          ) : (
            <div className={cn('divide-y divide-border', users.isFetching && 'opacity-60')}>
              {items.map((user) =>
                editing === user.id ? (
                  <EditRow
                    key={user.id}
                    user={user}
                    canChangeRole={isAdmin}
                    canResetPassword={isAdmin && user.id !== me?.id}
                    onDone={() => setEditing(0)}
                  />
                ) : (
                  <ReadRow
                    key={user.id}
                    user={user}
                    isMe={user.id === me?.id}
                    canEdit={isAdmin || user.id === me?.id}
                    canDelete={isAdmin && user.id !== me?.id}
                    onEdit={() => setEditing(user.id)}
                    onDelete={() => handleDelete(user)}
                  />
                ),
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && <p className="text-xs text-faint">{plural(items.length, 'person', 'people')}</p>}
    </div>
  )
}

function ReadRow({
  user,
  isMe,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  user: User
  isMe: boolean
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-2xs font-semibold text-accent">
        {user.username.slice(0, 2).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {user.name || user.username}
          </span>
          {isMe && <Badge tone="accent">you</Badge>}
        </div>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>

      <Badge tone={user.role === 'admin' ? 'warning' : user.role === 'manager' ? 'accent' : 'neutral'}>{user.role}</Badge>

      <div className="flex shrink-0 gap-1">
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onEdit}
            aria-label={`Edit ${user.username}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onDelete}
            aria-label={`Remove ${user.username}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function EditRow({
  user,
  canChangeRole,
  canResetPassword,
  onDone,
}: {
  user: User
  canChangeRole: boolean
  canResetPassword: boolean
  onDone: () => void
}) {
  const update = useUpdateUser()
  const resetPassword = useResetUserPassword()

  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState(user.role)
  const [newPassword, setNewPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  async function save() {
    setFieldErrors({})
    setFormError('')

    const body: Record<string, unknown> = { id: user.id, name, email }
    if (canChangeRole && role !== user.role) body.role = role

    try {
      await update.mutateAsync(body as { id: number })
      if (newPassword) {
        await resetPassword.mutateAsync({ id: user.id, newPassword })
      }
      onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields)
        if (Object.keys(err.fields).length === 0) setFormError(err.message)
      } else {
        setFormError('Could not reach the server')
      }
    }
  }

  return (
    <div className="space-y-3 bg-raised/40 px-4 py-3">
      {formError && (
        <p role="alert" className="text-xs text-danger">
          {formError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
      </div>

      {canResetPassword && (
        <Input
          label="New password"
          type="text"
          autoComplete="off"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={fieldErrors.new_password}
          hint="Leave empty to keep their password. Otherwise at least 8 characters; tell them what you set so they can sign in and change it."
        />
      )}

      {canChangeRole && (
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted">Role</span>
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Role">
            {ROLES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRole(option)}
                aria-pressed={role === option}
                className={cn(
                  'flex-1 rounded px-2 py-1 text-xs capitalize transition-colors',
                  role === option
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-raised hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          <X className="h-3 w-3" />
          Cancel
        </Button>
        <Button size="sm" onClick={save} loading={update.isPending || resetPassword.isPending}>
          <Check className="h-3 w-3" />
          Save
        </Button>
      </div>
    </div>
  )
}
